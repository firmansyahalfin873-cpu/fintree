import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export class DatabaseMigrationRequiredError extends Error {
  constructor() { super('Database migration is required'); this.name = 'DatabaseMigrationRequiredError'; }
}

const migrationFiles = [
  new URL('../../db/schema-draft.sql', import.meta.url),
  new URL('../../db/local-migrations/002-merchant-updated-at.sql', import.meta.url),
  new URL('../../db/local-migrations/003-checkout-details.sql', import.meta.url),
];

async function migrations() {
  return Promise.all(migrationFiles.map(async (file, index) => {
    const sql = await fs.readFile(file, 'utf8');
    return { version: index + 1, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

async function inspect(db, known) {
  const exists = (await db.query("select to_regnamespace('fintree_private') is not null as present")).rows[0].present;
  if (!exists) return 0;
  const table = (await db.query("select to_regclass('fintree_private.schema_version') is not null as present")).rows[0].present;
  if (!table) throw new Error('Existing database has no schema version; manual review is required');
  const rows = (await db.query('select version,checksum from fintree_private.schema_version order by version')).rows;
  if (!rows.length || rows.length > known.length) throw new Error('Unknown database schema; manual review is required');
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].version !== known[index].version || rows[index].checksum !== known[index].checksum) throw new Error('Database schema differs from known migrations; manual review is required');
  }
  return rows.length;
}

async function applyPending(db, known, applied) {
  if (applied >= known.length) return 0;
  const pending = known.slice(applied);
  let sql = 'begin;\n';
  if (applied === 0) {
    const baseline = pending.shift();
    sql += `${baseline.sql}\ncreate table fintree_private.schema_version (version integer primary key, checksum text not null);\n`;
    sql += 'alter table fintree_private.schema_version enable row level security; revoke all on fintree_private.schema_version from public;\n';
    sql += `insert into fintree_private.schema_version values (${baseline.version}, '${baseline.checksum}');\n`;
  }
  for (const entry of pending) sql += `${entry.sql}\ninsert into fintree_private.schema_version values (${entry.version}, '${entry.checksum}');\n`;
  try { await db.exec(`${sql}commit;`); }
  catch (error) { try { await db.exec('rollback'); } catch {} throw error; }
  return known.length - applied;
}

/** Local testnet storage, one process at a time; not a production database. */
export async function openLocalDatabase(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Database directory is required');
  const known = await migrations();
  await fs.mkdir(directory, { recursive: true });
  const db = new PGlite(directory);
  try {
    const applied = await inspect(db, known);
    if (applied === 0) await applyPending(db, known, applied);
    else if (applied < known.length) throw new DatabaseMigrationRequiredError();
    return db;
  } catch (error) { await db.close(); throw error; }
}

/** Explicitly upgrade a known local database. Take a verified backup first. */
export async function migrateLocalDatabase(directory) {
  if (typeof directory !== 'string' || !directory.trim() || !(await fs.stat(directory)).isDirectory()) throw new TypeError('Existing database directory is required');
  const known = await migrations(), db = new PGlite(directory);
  try {
    const applied = await inspect(db, known);
    if (applied === 0) throw new Error('No existing Fintree database found');
    return { applied: await applyPending(db, known, applied), currentVersion: known.length };
  } finally { await db.close(); }
}
