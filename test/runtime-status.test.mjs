import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeStatus } from '../src/server/runtime-status.mjs';

test('worker status distinguishes startup, progress, failure and stale cycles', async () => {
  let now = 1000;
  const status = createRuntimeStatus({ webhookEnabled: true, now: () => now, staleAfterMs: 30000 });
  assert.equal(status.snapshot().scanner.state, 'starting');
  const scan = status.track('scanner', async () => ({ status: 'ok' }));
  await scan(); assert.equal(status.snapshot().scanner.state, 'running');
  assert.equal(status.snapshot().scanner.lastSuccess, new Date(now).toISOString());
  await status.track('webhook', async () => ({ status: 'retry' }))();
  // This reports the worker, not whether an individual webhook succeeded.
  assert.equal(status.snapshot().webhook.state, 'running');
  await status.track('scanner', async () => ({ status: 'busy' }))();
  assert.equal(status.snapshot().scanner.state, 'delayed');
  await scan();
  await assert.rejects(status.track('scanner', async () => { throw new Error('secret details'); })());
  assert.equal(status.snapshot().scanner.state, 'delayed');
  assert.equal(JSON.stringify(status.snapshot()).includes('secret details'), false);
  await scan(); now += 30001;
  assert.equal(status.snapshot().scanner.state, 'delayed');
  assert.equal(status.snapshot().webhook.state, 'delayed');
  assert.equal(createRuntimeStatus({ webhookEnabled: false }).snapshot().webhook.state, 'disabled');
});
