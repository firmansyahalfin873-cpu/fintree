import { getAddress } from 'ethers';

// Browser retry hint: no API credential or plaintext order is persisted.
export async function createMerchantAttempt({ storage, crypto, merchant, body }) {
  if (typeof body !== 'string' || !crypto?.subtle || typeof crypto.randomUUID !== 'function') throw new TypeError('Invalid attempt');
  const address = getAddress(merchant).toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const fingerprint = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  const storageKey = `fintree:order:${address}:${fingerprint}`;
  let id;
  try { id = storage?.getItem(storageKey); } catch { /* Storage may be unavailable. */ }
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    id = crypto.randomUUID();
    try { storage?.setItem(storageKey, id); } catch { /* Caller retains it in memory. */ }
  }
  return { body, key: id, clear() { try { if (storage?.getItem(storageKey) === id) storage.removeItem(storageKey); } catch { /* Ignore unavailable storage. */ } } };
}
