import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { createSignerVault, unlockSignerVault } from '../src/deployment/signer-vault.mjs';

test('testnet signer is encrypted, can be unlocked, and cannot be silently replaced', { timeout: 30000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fintree-vault-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'signer.json');
  const password = 'test-only long passphrase';
  await assert.rejects(createSignerVault({ filename, password: 'short' }), /12 characters/);
  const created = await createSignerVault({ filename, password });
  const contents = await fs.readFile(filename, 'utf8');
  const unlocked = await unlockSignerVault({ filename, password, expectedAddress: created.address });
  assert.equal(unlocked.address, created.address);
  assert.equal(contents.includes(unlocked.privateKey.slice(2)), false);
  await assert.rejects(unlockSignerVault({ filename, password: 'incorrect password here' }));
  await assert.rejects(unlockSignerVault({ filename, password, expectedAddress: Wallet.createRandom().address }), /does not match/);
  await assert.rejects(createSignerVault({ filename, password }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(filename, 'utf8'), contents);
});
