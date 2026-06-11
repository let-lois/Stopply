// Adapter binding the pure rollup engine to a tenant database reached
// through the TenantD1 client.

import { runRollup, type RollupDb, type RollupOutputs } from '@letlois/attribution';
import type { Env } from './env';
import { tenantD1Client } from './provisioning';

export function rollupDbFor(env: Env, databaseId: string): RollupDb {
  const d1 = tenantD1Client(env);
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const { results } = await d1.query<T>(databaseId, sql, params);
      return results;
    },
    async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
      await d1.batch(databaseId, statements);
    },
  };
}

export async function runTenantRollup(env: Env, databaseId: string, month: string): Promise<RollupOutputs> {
  return runRollup(rollupDbFor(env, databaseId), month);
}
