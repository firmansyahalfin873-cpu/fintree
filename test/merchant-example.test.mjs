import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { initializeMerchantExample, receiveMerchantWebhook } from '../examples/merchant-webhook.mjs';
import { generateWebhookSecret, signWebhook } from '../src/webhooks/signature.mjs';

test('merchant example verifies and atomically deduplicates events even when they arrive out of order', { timeout: 30000 }, async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  await initializeMerchantExample(db);
  const secret = generateWebhookSecret(), invoice = `0x${'ab'.repeat(32)}`;
  const event = (type, id) => Buffer.from(JSON.stringify({ id, type, data: { invoice_id: invoice } }));
  const deliver = (body, signature = signWebhook(body, secret)) => receiveMerchantWebhook({ db, secret, body, signature });
  const paid = event('checkout.session.completed', 'evt_paid');
  assert.equal((await deliver(paid, 'invalid')).status, 400);
  assert.equal((await db.query('select count(*)::int as count from received_events')).rows[0].count, 0);
  const review = event('checkout.session.payment_review_required', 'evt_review');
  assert.equal((await deliver(review)).duplicate, false);
  assert.equal((await deliver(paid)).duplicate, false);
  assert.equal((await deliver(paid)).duplicate, true);
  assert.equal((await db.query('select status from payment_states where invoice_id=$1', [invoice])).rows[0].status, 'review_required');
  const another = event('checkout.session.completed', 'evt_retry');
  await db.exec('drop table payment_states');
  await assert.rejects(deliver(another));
  assert.equal((await db.query('select count(*)::int as count from received_events where id=$1', ['evt_retry'])).rows[0].count, 0);
  await initializeMerchantExample(db);
  assert.equal((await deliver(another)).duplicate, false);
});
