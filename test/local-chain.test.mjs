import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChain } from '../src/testing/local-chain.mjs';

test('local simulator rejects invalid network identifiers before starting', async () => {
  for (const chainId of [0, -1, 1.5, 4294967296, '1337', {}, [], Number.NaN]) {
    await assert.rejects(createLocalChain({ chainId }), RangeError);
  }
});
