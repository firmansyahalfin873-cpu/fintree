import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { runScannerCycle } from '../src/payments/scanner-cycle.mjs';
import { runScannerLoop } from '../src/payments/scanner-loop.mjs';

test('scanner persists checkpoint, rescans overlap and does not advance on RPC failure', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintree-scanner-'));
  t.after(() => { if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup path'); fs.rmSync(dir, { recursive: true, force: true }); });
  let db = new PGlite(dir);
  await db.exec(fs.readFileSync('db/schema-draft.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/local-migrations/003-checkout-details.sql', 'utf8'));
  const ranges = [];
  const provider = { getNetwork: async () => ({ chainId: 1337n }), getBlockNumber: async () => 110,
    getLogs: async ({ fromBlock, toBlock }) => { ranges.push([fromBlock, toBlock]); return []; } };
  const config = { db, provider, chainId: 1337n, contract: '0x1111111111111111111111111111111111111111', startBlock: 100, confirmations: 2, batchSize: 5, overlap: 2 };
  assert.equal((await runScannerCycle(config)).nextBlock, 105);
  assert.deepEqual(ranges[0], [100, 104]);
  await db.close();
  db = new PGlite(dir); config.db = db;
  assert.equal((await runScannerCycle(config)).nextBlock, 110);
  assert.deepEqual(ranges[1], [103, 109]);
  await assert.rejects(runScannerCycle({ ...config, provider: { ...provider, getLogs: async () => { throw new Error('RPC unavailable'); } } }), /RPC unavailable/);
  const state = (await db.query('select next_block,lease_token from fintree_private.scanner_state')).rows[0];
  assert.equal(Number(state.next_block), 110);
  assert.equal(state.lease_token, null);
  await db.exec("update fintree_private.scanner_state set lease_token='00000000-0000-0000-0000-000000000001',lease_until=now()+interval '1 minute'");
  assert.equal((await runScannerCycle(config)).status, 'busy');
  await db.close();
});

test('scanner loop retries errors with backoff and stops without overlapping cycles', async () => {
  const controller = new AbortController(), waits = [], errors = [];
  let calls = 0, running = false;
  await runScannerLoop({ signal: controller.signal, intervalMs: 10, maxDelayMs: 40,
    onError: (error) => errors.push(error.message),
    runCycle: async () => {
      assert.equal(running, false); running = true; calls++; await Promise.resolve(); running = false;
      if (calls <= 2) throw new Error('temporary');
      if (calls === 4) controller.abort();
    },
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.deepEqual(errors, ['temporary', 'temporary']);
  assert.deepEqual(waits, [20, 40, 10]);
  assert.equal(calls, 4);
});
