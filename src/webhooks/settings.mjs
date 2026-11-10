import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { generateWebhookSecret } from './signature.mjs';
import { validateWebhookUrl } from './https-transport.mjs';

/** Testnet-only encrypted storage. Keep the 256-bit master key outside the database. */
export function createWebhookSettings({ db, masterKey }) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new TypeError('A 32-byte webhook master key is required');
  const key = Buffer.from(masterKey);
  function encrypt(secret, merchantId, url) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`fintree-webhook:v1:${merchantId.toLowerCase()}:${url}`));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return ['v1', nonce.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join('.');
  }
  function decrypt(envelope, merchantId, url) {
    const parts = typeof envelope === 'string' ? envelope.split('.') : [];
    if (parts.length !== 4 || parts[0] !== 'v1' || !/^[0-9a-f]{24}$/.test(parts[1]) || !/^[0-9a-f]{32}$/.test(parts[2]) || !/^(?:[0-9a-f]{2})+$/.test(parts[3])) throw new Error('Invalid webhook secret envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'hex'));
    decipher.setAAD(Buffer.from(`fintree-webhook:v1:${merchantId.toLowerCase()}:${url}`));
    decipher.setAuthTag(Buffer.from(parts[2], 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString('utf8');
  }
  return {
    async assertKey() {
      const row = (await db.query('select merchant_id,destination_url,secret_envelope from fintree_private.webhook_settings limit 1')).rows[0];
      if (row) decrypt(row.secret_envelope, row.merchant_id, row.destination_url);
    },
    async configure(merchantId, destination) {
      const url = validateWebhookUrl(destination).href, secret = generateWebhookSecret();
      const envelope = encrypt(secret, merchantId, url);
      await db.query(`insert into fintree_private.webhook_settings (merchant_id,destination_url,secret_envelope) values ($1,$2,$3)
        on conflict (merchant_id) do update set destination_url=excluded.destination_url,secret_envelope=excluded.secret_envelope,updated_at=now()`, [merchantId, url, envelope]);
      return { url, secret };
    },
    async getPublic(merchantId) {
      const row = (await db.query('select destination_url,updated_at from fintree_private.webhook_settings where merchant_id=$1', [merchantId])).rows[0];
      return row ? { url: row.destination_url, updatedAt: new Date(row.updated_at).toISOString() } : null;
    },
    async listAttempts(merchantId) {
      const rows = (await db.query(`select a.event_id,a.attempt_number,a.response_status,a.outcome,a.created_at,o.status as delivery_status,o.attempts as total_attempts
        from fintree_private.webhook_attempts a join fintree_private.webhook_outbox o on o.event_id=a.event_id
        join fintree_private.invoices i on i.id=o.invoice_id where i.merchant_id=$1 order by a.created_at desc,a.id desc limit 30`, [merchantId])).rows;
      return rows.map((row) => ({ eventId: row.event_id, attempt: row.attempt_number, responseStatus: row.response_status, outcome: row.outcome, createdAt: new Date(row.created_at).toISOString(), retryable: row.delivery_status === 'failed' && row.outcome === 'failed' && row.attempt_number === row.total_attempts }));
    },
    async retryFailed(merchantId, eventId) {
      if (typeof eventId !== 'string' || !/^evt_[a-z0-9_]{1,160}$/.test(eventId)) throw new TypeError('Invalid event ID');
      const result = await db.query(`update fintree_private.webhook_outbox o set status='pending',next_attempt_at=now()
        where o.event_id=$1 and o.status='failed' and o.lease_token is null
          and exists (select 1 from fintree_private.invoices i join fintree_private.webhook_settings s on s.merchant_id=i.merchant_id where i.id=o.invoice_id and i.merchant_id=$2)
        returning o.event_id`, [eventId, merchantId]);
      return result.rows.length === 1;
    },
    async getForDelivery(merchantId) {
      const row = (await db.query('select destination_url,secret_envelope from fintree_private.webhook_settings where merchant_id=$1', [merchantId])).rows[0];
      return row ? { url: row.destination_url, secret: decrypt(row.secret_envelope, merchantId, row.destination_url) } : null;
    },
  };
}
