// Loops the tenant registry, applies pending tenant migrations to each
// tenant database over the D1 HTTP API, and bumps schema_version in the
// control plane. Requires CF_API_TOKEN, CF_ACCOUNT_ID, CONTROL_DB_ID.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { d1Query, requireEnv } from './lib/cf.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'packages/db/migrations/tenant');

const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f, i) => ({ version: i + 1, name: f, sql: readFileSync(join(dir, f), 'utf8') }));

function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s + ';');
}

const controlDbId = requireEnv('CONTROL_DB_ID');
const tenants = await d1Query(
  controlDbId,
  `SELECT id, slug, d1_database_id, schema_version FROM tenants WHERE status = 'active'`
);

for (const tenant of tenants) {
  if (!tenant.d1_database_id) {
    console.warn(`skipping ${tenant.slug}: no database id`);
    continue;
  }
  let version = tenant.schema_version ?? 0;
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    console.log(`${tenant.slug}: applying ${migration.name}`);
    for (const stmt of splitStatements(migration.sql)) {
      await d1Query(tenant.d1_database_id, stmt);
    }
    version = migration.version;
  }
  if (version !== tenant.schema_version) {
    await d1Query(controlDbId, `UPDATE tenants SET schema_version = ? WHERE id = ?`, [
      version,
      tenant.id,
    ]);
    console.log(`${tenant.slug}: schema_version -> ${version}`);
  } else {
    console.log(`${tenant.slug}: up to date (v${version})`);
  }
}
console.log(`done: ${tenants.length} tenants checked`);
