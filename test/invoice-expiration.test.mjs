import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { Wallet } from 'ethers';
import { createCheckoutSession } from '../src/payments/checkout-sessions.mjs';
import { expireInvoices } from '../src/payments/expire-invoices.mjs';

test('expiration only changes overdue pending invoices for the selected deployment', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(fs.readFileSync('db/schema-draft.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/local-migrations/003-checkout-details.sql', 'utf8'));
  const merchantId = '00000000-0000-0000-0000-000000000001', signer = Wallet.createRandom();
  await db.query('insert into fintree_private.merchants (id,wallet_address,business_name) values ($1,$2,$3)', [merchantId, Wallet.createRandom().address.toLowerCase(), 'Test']);
  const config = { chainId: 1337n, contract: Wallet.createRandom().address, token: Wallet.createRandom().address, signerAddress: signer.address, tokenDecimals: 6, feeBps: 30, ttlSeconds: 900 };
  const create = (key) => createCheckoutSession({ db, signer, config, merchantId, idempotencyKey: key, request: { orderId: key, amount: '1', feePayer: 'customer' } });
  const old = (await create('old')).session, confirming = (await create('confirming')).session, active = (await create('active')).session;
  await db.query("update fintree_private.invoices set deadline=now()-interval '1 second' where id=$1 or id=$2", [old.id, confirming.id]);
  await db.query("update fintree_private.invoices set status='confirming' where id=$1", [confirming.id]);
  assert.equal(await expireInvoices({ db, chainId: 1338n, contract: config.contract }), 0);
  assert.equal(await expireInvoices({ db, chainId: 1337n, contract: config.contract }), 1);
  const statuses = (await db.query('select id,status from fintree_private.invoices')).rows;
  assert.equal(statuses.find((row) => row.id === old.id).status, 'expired');
  assert.equal(statuses.find((row) => row.id === confirming.id).status, 'confirming');
  assert.equal(statuses.find((row) => row.id === active.id).status, 'pending');
});
