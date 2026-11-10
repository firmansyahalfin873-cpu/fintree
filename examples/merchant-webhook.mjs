// Example merchant receiver. The database update is a demonstration, not fulfillment.
import { verifyWebhook } from '../src/sdk/index.mjs';

export async function initializeMerchantExample(db) {
  await db.exec(`create table if not exists received_events (id text primary key, received_at timestamptz not null default now());
    create table if not exists payment_states (invoice_id text primary key, status text not null check (status in ('paid','review_required')));`);
}

/** Verifies the raw bytes, deduplicates, and changes example state in one transaction. */
export async function receiveMerchantWebhook({ db, secret, body, signature }) {
  if (!Buffer.isBuffer(body) || body.length > 65536 || !verifyWebhook(body, signature, secret)) return { status: 400 };
  let event;
  try { event = JSON.parse(body.toString('utf8')); } catch { return { status: 400 }; }
  if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !/^evt_[a-z0-9_]{1,160}$/.test(event.id) ||
      typeof event.type !== 'string' || typeof event.data?.invoice_id !== 'string' || !/^0x[0-9a-f]{64}$/.test(event.data.invoice_id)) return { status: 400 };
  if (!['checkout.session.completed', 'checkout.session.payment_review_required'].includes(event.type)) return { status: 200, ignored: true };
  return db.transaction(async (tx) => {
    const inserted = await tx.query('insert into received_events (id) values ($1) on conflict do nothing returning id', [event.id]);
    if (!inserted.rows.length) return { status: 200, duplicate: true };
    const status = event.type === 'checkout.session.completed' ? 'paid' : 'review_required';
    await tx.query(`insert into payment_states (invoice_id,status) values ($1,$2)
      on conflict (invoice_id) do update set status=case when payment_states.status='review_required' then 'review_required' else excluded.status end`, [event.data.invoice_id, status]);
    return { status: 200, duplicate: false };
  });
}
