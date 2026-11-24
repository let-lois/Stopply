// Cron Worker. Hourly: incremental integration sync for the current
// month plus draining debounced rollup flags. Nightly: full re sync of
// the current and previous month, rollups for the trailing 4 months,
// the agency rollup pull into the control plane, and database backups
// to R2 with 30 day retention. Per tenant failures isolate: one tenant's
// bad credentials never block the loop. A connection's first sync reaches
// further back when its connector asks for history (Apple Maps: 90 days by
// default), and every nightly run re-reads the previous month too, which is
// what picks up conversions a platform attributes late.

import { runRollup, isFunnelStage } from '@letlois/attribution';
import { CONNECTORS } from '@letlois/connectors';
import { TenantD1, exportDatabase } from '@letlois/tenant-d1';

export interface SyncEnv {
  CONTROL_DB: D1Database;
  CSV_BUCKET: R2Bucket;
  SESSIONS: KVNamespace;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CRED_MASTER_KEY: string;
  // Database id of the control plane, for the nightly backup.
  CONTROL_DB_ID?: string;
}

interface TenantRow {
  id: string;
  slug: string;
  d1_database_id: string | null;
}

function client(env: SyncEnv): TenantD1 {
  return new TenantD1({ accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
}

function dbFor(env: SyncEnv, databaseId: string) {
  const d1 = client(env);
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

// Every month touched by the last `days` days, newest first.
export function monthsCovering(days: number, nowMs = Date.now()): string[] {
  const start = new Date(nowMs - Math.max(0, days - 1) * 86_400_000);
  const now = new Date(nowMs);
  const span = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth() + 1;
  return monthsBack(span);
}

function failureOf(err: unknown): string {
  const failure = err && typeof err === 'object' ? (err as { failure?: unknown }).failure : undefined;
  return typeof failure === 'string' ? failure : 'error';
}

function monthsBack(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

async function activeTenants(env: SyncEnv): Promise<TenantRow[]> {
  const { results } = await env.CONTROL_DB.prepare(
    `SELECT id, slug, d1_database_id FROM tenants WHERE status = 'active' AND d1_database_id IS NOT NULL`
  ).all<TenantRow>();
  return results;
}

async function decryptCreds(env: SyncEnv, ciphertext: string, ivB64: string): Promise<Record<string, string>> {
  const raw = Uint8Array.from(atob(env.CRED_MASTER_KEY), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['decrypt']);
  const iv = Uint8Array.from(atob(ivB64), (ch) => ch.charCodeAt(0));
  const ct = Uint8Array.from(atob(ciphertext), (ch) => ch.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return JSON.parse(new TextDecoder().decode(pt)) as Record<string, string>;
}

// Returns every month written to, so the caller can roll up a backfilled
// month at once instead of waiting for the nightly window to reach it.
async function syncTenantIntegrations(env: SyncEnv, tenant: TenantRow, months: string[]): Promise<Set<string>> {
  const touched = new Set<string>(months);
  const d1 = client(env);
  const databaseId = tenant.d1_database_id!;
  const { results: integrations } = await d1.query<{
    key: string;
    provider: string;
    status: string;
    credentials_ciphertext: string | null;
    credentials_iv: string | null;
    last_sync_at: string | null;
  }>(
    databaseId,
    `SELECT key, provider, status, credentials_ciphertext, credentials_iv, last_sync_at FROM integrations WHERE status = 'connected'`
  );

  for (const integration of integrations) {
    const connector = CONNECTORS[integration.provider];
    if (!connector || !integration.credentials_ciphertext || !integration.credentials_iv) continue;
    try {
      const creds = await decryptCreds(env, integration.credentials_ciphertext, integration.credentials_iv);
      const { results: mapRows } = await d1.query<{ external_event: string; stage: string }>(
        databaseId,
        `SELECT external_event, stage FROM funnel_stage_map WHERE integration_key = ?`,
        [integration.key]
      );
      const stageMap = new Map(
        mapRows.filter((r) => isFunnelStage(r.stage)).map((r) => [r.external_event, r.stage as never])
      );
      // Never synced and the connector wants history: backfill, oldest
      // month first so last_sync_result ends on the current month.
      const backfill = !integration.last_sync_at && connector.backfillDays ? monthsCovering(connector.backfillDays(creds)) : null;
      const toSync = backfill ? [...new Set([...backfill, ...months])].sort() : months;
      for (const month of toSync) {
        touched.add(month);
        const stats = await connector.syncMonth(creds, month, dbFor(env, databaseId), integration.key, { stageMap });
        await d1.query(
          databaseId,
          `UPDATE integrations SET last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_sync_result = ? WHERE key = ?`,
          [JSON.stringify({ ok: true, month, stats }), integration.key]
        );
        await d1.query(
          databaseId,
          `UPDATE sources SET last_import_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?`,
          [integration.key]
        );
      }
    } catch (err) {
      // Errors land on the integration and flag the source red; the loop
      // continues with the next integration and tenant.
      const message = err instanceof Error ? err.message : 'sync failed';
      await d1
        .query(databaseId, `UPDATE integrations SET status = 'error', last_sync_result = ? WHERE key = ?`, [
          JSON.stringify({ ok: false, error: message, failure: failureOf(err), at: new Date().toISOString() }),
          integration.key,
        ])
        .catch(() => undefined);
    }
  }
  return touched;
}

async function runTenantRollups(env: SyncEnv, tenant: TenantRow, months: string[]): Promise<void> {
  for (const month of months) {
    await runRollup(dbFor(env, tenant.d1_database_id!), month);
  }
}

async function pullAgencyRollup(env: SyncEnv, tenant: TenantRow, months: string[]): Promise<void> {
  const db = dbFor(env, tenant.d1_database_id!);
  for (const month of months) {
    const rows = await db.query<{
      leads: number;
      scheduled: number;
      completed: number;
      purchases: number;
      revenue: number;
      spend: number;
    }>(
      `SELECT COALESCE(SUM(leads),0) leads, COALESCE(SUM(scheduled),0) scheduled,
         COALESCE(SUM(completed),0) completed, COALESCE(SUM(purchases),0) purchases,
         COALESCE(SUM(revenue),0) revenue, COALESCE(SUM(spend),0) spend
       FROM monthly_metrics WHERE period_month = ? AND attribution_basis = 'first'`,
      [month]
    );
    const r = rows[0];
    if (!r) continue;
    await env.CONTROL_DB.prepare(
      `INSERT INTO agency_rollup (tenant_id, period_month, leads, scheduled, completed, purchases, revenue, spend, pulled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT (tenant_id, period_month) DO UPDATE SET leads = excluded.leads,
         scheduled = excluded.scheduled, completed = excluded.completed, purchases = excluded.purchases,
         revenue = excluded.revenue, spend = excluded.spend, pulled_at = excluded.pulled_at`
    )
      .bind(tenant.id, month, r.leads, r.scheduled, r.completed, r.purchases, r.revenue, r.spend)
      .run();
  }
}

async function backupTenant(env: SyncEnv, tenant: TenantRow): Promise<void> {
  const url = await exportDatabase(
    { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN },
    tenant.d1_database_id!
  );
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`backup download failed: ${res.status}`);
  const date = new Date().toISOString().slice(0, 10);
  await env.CSV_BUCKET.put(`backups/${tenant.slug}/${date}.sql`, res.body);
}

async function pruneBackups(env: SyncEnv): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const list = await env.CSV_BUCKET.list({ prefix: 'backups/' });
  for (const obj of list.objects) {
    const match = obj.key.match(/(\d{4}-\d{2}-\d{2})\.sql$/);
    if (match && match[1]! < cutoff) await env.CSV_BUCKET.delete(obj.key);
  }
}

async function drainPendingRollups(env: SyncEnv): Promise<void> {
  const list = await env.SESSIONS.list({ prefix: 'rollup:pending:' });
  if (list.keys.length === 0) return;
  const tenants = await activeTenants(env);
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const months = monthsBack(2);
  for (const key of list.keys) {
    const tenantId = key.name.slice('rollup:pending:'.length);
    const tenant = byId.get(tenantId);
    if (tenant) {
      try {
        await runTenantRollups(env, tenant, months);
      } catch (err) {
        console.error(`rollup drain failed for ${tenantId}`, err instanceof Error ? err.message : err);
      }
    }
    await env.SESSIONS.delete(key.name);
  }
}

export async function runHourly(env: SyncEnv): Promise<void> {
  const tenants = await activeTenants(env);
  const currentMonth = monthsBack(1);
  for (const tenant of tenants) {
    try {
      const touched = await syncTenantIntegrations(env, tenant, currentMonth);
      await runTenantRollups(env, tenant, [...touched]);
    } catch (err) {
      console.error(`hourly sync failed for ${tenant.slug}`, err instanceof Error ? err.message : err);
    }
  }
  await drainPendingRollups(env);
}

export async function runNightly(env: SyncEnv): Promise<void> {
  const tenants = await activeTenants(env);
  const syncMonths = monthsBack(2);
  const rollupMonths = monthsBack(4);
  for (const tenant of tenants) {
    try {
      const touched = await syncTenantIntegrations(env, tenant, syncMonths);
      await runTenantRollups(env, tenant, [...new Set([...rollupMonths, ...touched])]);
      await pullAgencyRollup(env, tenant, rollupMonths);
      await backupTenant(env, tenant);
    } catch (err) {
      console.error(`nightly batch failed for ${tenant.slug}`, err instanceof Error ? err.message : err);
    }
  }
  // Back up the control plane alongside the tenants.
  if (env.CONTROL_DB_ID) {
    try {
      const url = await exportDatabase(
        { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN },
        env.CONTROL_DB_ID
      );
      const res = await fetch(url);
      if (res.ok && res.body) {
        const date = new Date().toISOString().slice(0, 10);
        await env.CSV_BUCKET.put(`backups/control/${date}.sql`, res.body);
      }
    } catch (err) {
      console.error('control plane backup failed', err instanceof Error ? err.message : err);
    }
  }
  await pruneBackups(env);
  // Email report scheduling stub. A future cron entry would render each
  // tenant's monthly summary and send it. Intentionally absent in v1:
  // crons = ["0 14 1 * *"] and a sendScheduledReports(env) call here.
  // await sendScheduledReports(env);
}

export default {
  async scheduled(event: ScheduledController, env: SyncEnv, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '10 9 * * *') {
      ctx.waitUntil(runNightly(env));
    } else {
      ctx.waitUntil(runHourly(env));
    }
  },
};
