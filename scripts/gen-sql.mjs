// Regenerates packages/db/src/sql.generated.ts from the canonical .sql
// migration files so Workers, Vitest, and Node scripts can all import the
// SQL without bundler specific raw loaders. Run after editing migrations:
//   node scripts/gen-sql.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'packages/db/migrations');

function loadDir(sub) {
  const dir = join(migrationsDir, sub);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f, i) => ({
      version: i + 1,
      name: f.replace(/\.sql$/, ''),
      sql: readFileSync(join(dir, f), 'utf8'),
    }));
}

const control = loadDir('control');
const tenant = loadDir('tenant');

const out = `// GENERATED FILE. Do not edit by hand.
// Source of truth: packages/db/migrations/**.sql
// Regenerate with: node scripts/gen-sql.mjs

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const CONTROL_MIGRATIONS: Migration[] = ${JSON.stringify(control, null, 2)};

export const TENANT_MIGRATIONS: Migration[] = ${JSON.stringify(tenant, null, 2)};
`;

writeFileSync(join(root, 'packages/db/src/sql.generated.ts'), out);
console.log(`generated sql.generated.ts: ${control.length} control, ${tenant.length} tenant migrations`);
