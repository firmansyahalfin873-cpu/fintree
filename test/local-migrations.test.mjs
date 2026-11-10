import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { openLocalDatabase, migrateLocalDatabase, DatabaseMigrationRequiredError } from '../src/storage/local-database.mjs';

async function baseline(dir) {
  const sql = fs.readFileSync('db/schema-draft.sql', 'utf8');
  const hash = createHash('sha256').update(sql).digest('hex');
  const db = new PGlite(dir);
  await db.exec(`${sql}\ncreate table fintree_private.schema_version (version integer primary key,checksum text not null);\nalter table fintree_private.schema_version enable row level security;\nrevoke all on fintree_private.schema_version from public;\ninsert into fintree_private.schema_version values (1,'${hash}');`);
  return db;
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintree-migration-'));
  t.after(() => { if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup path'); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('explicit local migration preserves existing merchant and invoice data', { timeout: 60000 }, async (t) => {
  const dir = temp(t), merchantId = '00000000-0000-0000-0000-000000000001', invoiceId = `0x${'a'.repeat(64)}`, wallet = `0x${'1'.repeat(40)}`;
  let db = await baseline(dir);
  await db.query('insert into fintree_private.merchants (id,wallet_address,business_name) values ($1,$2,$3)', [merchantId, wallet, 'Existing merchant']);
  await db.query(`insert into fintree_private.invoices (id,merchant_id,idempotency_key,request_hash,external_order_id,chain_id,contract_address,token_address,merchant_address,invoice_amount,merchant_amount,protocol_fee,total_payable,fee_bps,fee_payer,quote_signature,deadline)
    values ($1,$2,'old-key',$3,'old-order',1337,$4,$4,$4,1000000,1000000,3000,1003000,30,'customer','0xab',now()+interval '1 hour')`, [invoiceId, merchantId, 'a'.repeat(64), wallet]);
  await db.close();
  await assert.rejects(openLocalDatabase(dir), DatabaseMigrationRequiredError);
  assert.deepEqual(await migrateLocalDatabase(dir), { applied: 2, currentVersion: 3 });
  assert.deepEqual(await migrateLocalDatabase(dir), { applied: 0, currentVersion: 3 });
  db = await openLocalDatabase(dir);
  const merchant = (await db.query('select business_name,updated_at from fintree_private.merchants where id=$1', [merchantId])).rows[0];
  assert.equal(merchant.business_name, 'Existing merchant');
  assert.ok(merchant.updated_at);
  assert.equal((await db.query('select external_order_id from fintree_private.invoices where id=$1', [invoiceId])).rows[0].external_order_id, 'old-order');
  assert.equal((await db.query('select count(*)::int as count from fintree_private.schema_version')).rows[0].count, 3);
  await db.close();
});

test('failed migration rolls back and leaves the original schema version intact', { timeout: 60000 }, async (t) => {
  const dir = temp(t); let db = await baseline(dir);
  await db.exec('alter table fintree_private.merchants add column updated_at timestamptz');
  await db.close();
  await assert.rejects(migrateLocalDatabase(dir));
  db = new PGlite(dir);
  assert.deepEqual((await db.query('select version from fintree_private.schema_version order by version')).rows.map((row) => row.version), [1]);
  await db.close();
});
