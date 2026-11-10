import { createHash, randomBytes, randomUUID } from 'node:crypto';

const KEY_PATTERN = /^fintree_test_[0-9a-f]{64}$/;
const hashKey = (key) => createHash('sha256').update(key, 'utf8').digest('hex');

export function prepareApiKey() {
  const id = randomUUID();
  const key = `fintree_test_${randomBytes(32).toString('hex')}`;
  return { id, key, prefix: key.slice(0, 21), hash: hashKey(key) };
}

/** Only call after independently authenticating the merchant. */
export async function issueApiKey(db, merchantId) {
  const { id, key, prefix, hash } = prepareApiKey();
  await db.query('insert into fintree_private.api_keys (id, merchant_id, key_hash, key_prefix) values ($1,$2,$3,$4)', [id, merchantId, hash, prefix]);
  return { id, key, prefix };
}

export async function authenticateApiKey(db, key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return null;
  const result = await db.query('select merchant_id, id from fintree_private.api_keys where key_hash = $1 and revoked_at is null', [hashKey(key)]);
  return result.rows[0] ? { merchantId: result.rows[0].merchant_id, keyId: result.rows[0].id } : null;
}

/** Only call after independently authenticating the merchant. */
export async function revokeApiKey(db, merchantId, keyId) {
  const result = await db.query('update fintree_private.api_keys set revoked_at = now() where id = $1 and merchant_id = $2 and revoked_at is null returning id', [keyId, merchantId]);
  return result.rows.length === 1;
}
