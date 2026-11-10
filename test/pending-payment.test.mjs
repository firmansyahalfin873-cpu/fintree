import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingPayment } from '../src/checkout/pending-payment.mjs';

test('submitted transaction hint survives reload and remains scoped to a checkout', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const options = { storage, chainId: 84532n, contract: `0x${'12'.repeat(20)}`, invoiceId: `0x${'ab'.repeat(32)}` };
  const hash = `0x${'cd'.repeat(32)}`;
  const first = createPendingPayment(options);
  assert.equal(first.get(), null); first.markRequested();
  assert.equal(createPendingPayment(options).get(), 'requesting');
  first.set(hash);
  const reloaded = createPendingPayment(options);
  assert.equal(reloaded.get(), hash);
  assert.equal(createPendingPayment({ ...options, invoiceId: `0x${'ff'.repeat(32)}` }).get(), null);
  assert.equal(createPendingPayment({ ...options, chainId: 1n }).get(), null);
  assert.throws(() => first.set('bad hash'));
  reloaded.clear(); assert.equal(first.get(), null);
  const unavailable = createPendingPayment({ ...options, storage: { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } } });
  assert.equal(unavailable.get(), null); unavailable.markRequested(); unavailable.set(hash); unavailable.clear();
});
