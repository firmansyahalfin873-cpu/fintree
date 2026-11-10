import test from 'node:test';
import assert from 'node:assert/strict';
import { FintreeApiError, FintreeClient } from '../src/sdk/index.mjs';

test('SDK sends authenticated requests and preserves idempotency key', async () => {
  const key = `fintree_test_${'1'.repeat(64)}`, requests = [];
  const client = new FintreeClient({ apiKey: key, baseUrl: 'https://api.example/', fetchImpl: async (url, options) => {
    requests.push({ url, options }); return new Response(JSON.stringify({ id: `0x${'a'.repeat(64)}` }), { status: 201 });
  } });
  assert.equal(JSON.stringify(client).includes(key), false);
  await client.createCheckoutSession({ orderId: 'order', amount: '5', feePayer: 'customer' }, { idempotencyKey: 'key-1' });
  assert.equal(requests[0].url, 'https://api.example/api/v1/checkout/sessions');
  assert.equal(requests[0].options.headers.authorization, `Bearer ${key}`);
  assert.equal(requests[0].options.headers['idempotency-key'], 'key-1');
  assert.equal(requests[0].options.redirect, 'error');
  await client.getCheckoutSession(`0x${'a'.repeat(64)}`);
  assert.equal(requests[1].options.method, 'GET');
  await assert.rejects(client.createCheckoutSession({}, {}), TypeError);
});

test('SDK rejects insecure destinations and exposes errors without exposing credentials', async () => {
  const apiKey = `fintree_test_${'2'.repeat(64)}`;
  assert.throws(() => new FintreeClient({ apiKey, baseUrl: 'http://example.com/' }), TypeError);
  assert.throws(() => new FintreeClient({ apiKey, baseUrl: 'https://user:pass@example.com/' }), TypeError);
  const client = new FintreeClient({ apiKey, baseUrl: 'http://127.0.0.1:3000/', fetchImpl: async () => new Response('{"error":"idempotency_conflict"}', { status: 409 }) });
  await assert.rejects(client.createCheckoutSession({}, { idempotencyKey: 'key-1' }), (error) => error instanceof FintreeApiError && error.status === 409 && error.code === 'idempotency_conflict' && !error.message.includes(apiKey));
});
