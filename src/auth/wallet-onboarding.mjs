import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getAddress, verifyMessage, ZeroAddress } from 'ethers';
import { prepareApiKey } from './api-keys.mjs';

const hashNonce = (nonce) => createHash('sha256').update(nonce, 'utf8').digest('hex');
const messageFor = ({ origin, wallet, nonce, expires }) => `Fintree wallet verification\nOrigin: ${origin}\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${expires}`;

export async function createWalletChallenge(db, wallet, origin) {
  const address = getAddress(wallet);
  if (address === ZeroAddress) throw new TypeError('Invalid wallet');
  const url = new URL(origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname))) throw new TypeError('Invalid origin');
  const id = randomUUID(), nonce = randomBytes(32).toString('hex');
  const result = await db.query(`insert into fintree_private.wallet_challenges (id,wallet_address,nonce_hash,origin,expires_at)
    values ($1,$2,$3,$4,date_trunc('second', now()) + interval '5 minutes') returning expires_at`, [id, address.toLowerCase(), hashNonce(nonce), origin]);
  const expires = new Date(result.rows[0].expires_at).toISOString();
  return { id, nonce, expires, message: messageFor({ origin, wallet: address.toLowerCase(), nonce, expires }) };
}

/** Challenge is single use; key creation and consumption succeed or fail together. */
export async function completeWalletChallenge(db, { id, nonce, signature, origin }) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || typeof nonce !== 'string' || !/^[0-9a-f]{64}$/.test(nonce) || typeof signature !== 'string') throw new TypeError('Invalid challenge');
  const challenge = (await db.query('select * from fintree_private.wallet_challenges where id=$1', [id])).rows[0];
  if (!challenge || challenge.used_at || challenge.origin !== origin || challenge.nonce_hash !== hashNonce(nonce)) return null;
  let recovered;
  try { recovered = verifyMessage(messageFor({ origin, wallet: challenge.wallet_address, nonce, expires: new Date(challenge.expires_at).toISOString() }), signature); }
  catch { return null; }
  if (recovered.toLowerCase() !== challenge.wallet_address) return null;
  const apiKey = prepareApiKey(), merchantId = randomUUID();
  const result = await db.query(`with consumed as (
      update fintree_private.wallet_challenges set used_at=now()
      where id=$1 and used_at is null and expires_at > now() and nonce_hash=$2 and origin=$3
      returning wallet_address
    ), merchant as (
      insert into fintree_private.merchants (id,wallet_address,business_name)
      select $4, wallet_address, 'Developer' from consumed
      on conflict (wallet_address) do update set wallet_address=excluded.wallet_address
      returning id
    ), issued as (
      insert into fintree_private.api_keys (id,merchant_id,key_hash,key_prefix)
      select $5,id,$6,$7 from merchant returning merchant_id
    ) select merchant_id from issued`, [id, hashNonce(nonce), origin, merchantId, apiKey.id, apiKey.hash, apiKey.prefix]);
  if (!result.rows.length) return null;
  return { merchantId: result.rows[0].merchant_id, keyId: apiKey.id, apiKey: apiKey.key, keyPrefix: apiKey.prefix };
}
