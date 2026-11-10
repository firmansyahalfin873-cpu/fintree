import { migrateLocalDatabase } from '../src/storage/local-database.mjs';

const directory = process.env.FINTREE_DATABASE_PATH || '.fintree-data/testnet';
try {
  const result = await migrateLocalDatabase(directory);
  console.log(`Local database version ${result.currentVersion}; migrations applied: ${result.applied}.`);
} catch {
  console.error('Local database migration failed. Verify the path, backup, and schema version before retrying.');
  process.exitCode = 1;
}
