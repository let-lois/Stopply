// Migration registries. The .sql files under packages/db/migrations are
// canonical; sql.generated.ts is produced from them by scripts/gen-sql.mjs
// so every runtime (Workers, Vitest, Node scripts) can import the SQL.

import { CONTROL_MIGRATIONS, TENANT_MIGRATIONS } from './sql.generated';
import type { Migration } from './sql.generated';

export { CONTROL_MIGRATIONS, TENANT_MIGRATIONS };
export type { Migration };

export const TENANT_SCHEMA_VERSION = TENANT_MIGRATIONS.length;

// Splits a migration file into executable statements. Our migration files
// keep semicolons out of string literals, so a line based split is safe.
export function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s + ';');
}
