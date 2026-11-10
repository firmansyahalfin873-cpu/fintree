import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWebhookTransport } from '../src/webhooks/https-transport.mjs';

const delivery = { url: 'https://merchant.example/hook?x=1', body: Buffer.from('{}'), headers: { 'content-type': 'application/json', 'x-fintree-signature': 't=1,v1=test' } };

test('pins a validated public address and does not follow redirects', async () => {
  let called = 0;
  const transport = createWebhookTransport({ lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: (options, callback) => {
    called++;
    assert.equal(options.hostname, 'merchant.example');
    assert.equal(options.servername, 'merchant.example');
    assert.equal(options.path, '/hook?x=1');
    options.lookup('ignored', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
    const req = new EventEmitter();
    req.end = () => callback({ statusCode: 302, destroy() {} });
    return req;
  } });
  assert.deepEqual(await transport(delivery), { status: 302 });
  assert.equal(called, 1);
});

test('rejects unsafe URLs and DNS answers before making a request', async () => {
  let called = false;
  const request = () => { called = true; throw new Error('must not connect'); };
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '0.0.0.0', '::1']) {
    const transport = createWebhookTransport({ lookup: async () => [{ address, family: netFamily(address) }], request });
    await assert.rejects(transport(delivery));
  }
  const mixed = createWebhookTransport({ lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], request });
  await assert.rejects(mixed(delivery));
  for (const url of ['http://merchant.example', 'https://127.0.0.1/', 'https://user:pass@merchant.example/', 'https://merchant.example:8443/', 'https://merchant.example/#fragment']) {
    await assert.rejects(mixed({ ...delivery, url }));
  }
  assert.equal(called, false);
});

test('bounds time spent resolving DNS', async () => {
  const transport = createWebhookTransport({ lookup: () => new Promise(() => {}), request: () => { throw new Error('must not connect'); }, timeoutMs: 100 });
  await assert.rejects(transport(delivery), /timeout/);
});

function netFamily(address) { return address.includes(':') ? 6 : 4; }
