import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { generateWebhookSecret, signWebhook, verifyWebhook } from '../src/webhooks/signature.mjs';

const secret = `whsec_${'12'.repeat(32)}`;
const body = Buffer.from('{"id":"evt_1","amount":"15"}\n', 'utf8');
const now = 1700000000;

test('signs exact payload bytes and verifies against an independently computed HMAC', () => {
  const digest = createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${now}.`), body])).digest('hex');
  const header = `t=${now},v1=${digest}`;
  assert.equal(signWebhook(body, secret, now), header);
  assert.equal(verifyWebhook(body, header, secret, { now }), true);
  assert.equal(verifyWebhook(Buffer.from(body.toString().trim()), header, secret, { now }), false);
  assert.equal(verifyWebhook(body, header, `whsec_${'34'.repeat(32)}`, { now }), false);
});

test('rejects stale, future, modified and ambiguous headers', () => {
  const header = signWebhook(body, secret, now);
  assert.equal(verifyWebhook(body, header, secret, { now: now + 300 }), true);
  assert.equal(verifyWebhook(body, header, secret, { now: now + 301 }), false);
  assert.equal(verifyWebhook(body, header, secret, { now: now - 301 }), false);
  for (const bad of [header + ',v1=' + '0'.repeat(64), header.toUpperCase(), header.replace('t=', 't=0'), 'not-a-header', '', null]) {
    assert.equal(verifyWebhook(body, bad, secret, { now }), false);
  }
  const changed = header.slice(0, -1) + (header.endsWith('0') ? '1' : '0');
  assert.equal(verifyWebhook(body, changed, secret, { now }), false);
});

test('uses random secrets and rejects unsafe inputs', () => {
  const a = generateWebhookSecret();
  const b = generateWebhookSecret();
  assert.match(a, /^whsec_[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.throws(() => signWebhook('{}', a, now), TypeError);
  assert.throws(() => signWebhook(body, 'secret', now), TypeError);
  assert.throws(() => verifyWebhook(body, '', a, { now, toleranceSeconds: -1 }), RangeError);
});
