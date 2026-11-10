import { randomUUID } from 'node:crypto';
import { prepareWebhookDelivery } from './prepare-delivery.mjs';

/**
 * Process one event using server-owned configuration and an injected transport.
 * Transport must enforce HTTPS, safe DNS/IP/redirect handling and a timeout
 * shorter than the lease. This module alone is not a safe network transport.
 */
export async function deliverNextWebhook({ db, getDeliveryConfig, transport, maxAttempts = 8, leaseSeconds = 60, configuredOnly = false }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 || !Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) throw new RangeError('Invalid delivery policy');
  const lease = randomUUID();
  const claim = await db.query(`with candidate as (
      select event_id from fintree_private.webhook_outbox
      where status='pending' and next_attempt_at <= now() and (lease_until is null or lease_until < now())
        and (not $3::boolean or exists (select 1 from fintree_private.invoices i join fintree_private.webhook_settings s on s.merchant_id=i.merchant_id where i.id=webhook_outbox.invoice_id))
      order by next_attempt_at, event_id for update skip locked limit 1
    ) update fintree_private.webhook_outbox as o set lease_token=$1, lease_until=now()+($2::int * interval '1 second'), attempts=attempts+1
      from candidate where o.event_id=candidate.event_id
      returning o.event_id,o.invoice_id,o.payload,o.attempts,
        (select coalesce(max(a.attempt_number),0) from fintree_private.webhook_attempts a where a.event_id=o.event_id and a.outcome='failed') as previous_failed`, [lease, leaseSeconds, configuredOnly]);
  if (!claim.rows.length) return { status: 'idle' };
  const event = claim.rows[0];
  let statusCode = null;
  try {
    const invoice = (await db.query('select merchant_id from fintree_private.invoices where id=$1', [event.invoice_id])).rows[0];
    if (!invoice) throw new Error('Invoice missing');
    const config = await getDeliveryConfig(invoice.merchant_id);
    if (!config || typeof config.url !== 'string') throw new Error('Webhook not configured');
    const delivery = prepareWebhookDelivery(event.payload, config.secret);
    const response = await transport({ url: config.url, ...delivery });
    if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599) throw new Error('Invalid response');
    statusCode = response.status;
  } catch { /* Record generic failure without leaking secrets or network details. */ }
  const succeeded = statusCode !== null && statusCode >= 200 && statusCode < 300;
  const cycleAttempt = event.attempts - Number(event.previous_failed);
  const outcome = succeeded ? 'delivered' : cycleAttempt >= maxAttempts ? 'failed' : 'retry';
  const delay = Math.min(3600, 30 * 2 ** Math.min(cycleAttempt - 1, 7));
  const committed = await db.query(`with updated as (
      update fintree_private.webhook_outbox set status=$3, lease_token=null, lease_until=null,
        next_attempt_at=case when $3='pending' then now()+($4::int * interval '1 second') else next_attempt_at end
      where event_id=$1 and lease_token=$2 and lease_until > now() returning event_id,attempts
    ), logged as (
      insert into fintree_private.webhook_attempts (id,event_id,attempt_number,response_status,outcome)
      select $5,event_id,attempts,$6,$7 from updated returning event_id
    ) select event_id from logged`, [event.event_id, lease, outcome === 'retry' ? 'pending' : outcome, delay, randomUUID(), statusCode, outcome]);
  return committed.rows.length ? { status: outcome, eventId: event.event_id, attempt: event.attempts } : { status: 'lease_expired', eventId: event.event_id };
}
