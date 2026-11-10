import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createMerchantAttempt } from '../src/checkout/merchant-attempt.mjs';

test('merchant retries reuse the same key across reloads without storing the order or credential', async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const opts = { storage, crypto: webcrypto, merchant: `0x${'12'.repeat(20)}`, body: JSON.stringify({ orderId: 'private-order', amount: '15.00' }) };
  const first = await createMerchantAttempt(opts);
  const retry = await createMerchantAttempt(opts);
  assert.equal(retry.key, first.key);
  assert.equal(JSON.stringify([...values]).includes('private-order'), false);
  const other = await createMerchantAttempt({ ...opts, merchant: `0x${'34'.repeat(20)}` });
  assert.notEqual(other.key, first.key);
  retry.clear();
  assert.notEqual((await createMerchantAttempt(opts)).key, first.key);
  assert.equal((await createMerchantAttempt({ ...opts, merchant: `0x${'34'.repeat(20)}` })).key, other.key);
});
