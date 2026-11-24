import { Hono } from 'hono';
import { z } from 'zod';
import { CONNECTORS, describeIntegrationState, isTransientFailure, type AdSyncStats, type ConnectorDb } from '@letlois/connectors';
import { isFunnelStage } from '@letlois/attribution';
import type { AppContext, Env } from '../env';
import { tenantScope, tenantWrite } from '../middleware';
import { tenantD1Client } from '../provisioning';
import { decryptCredentials, encryptCredentials } from '../crypto';
import { writeAudit } from '../audit';
import { runTenantRollup } from '../rollup';

export const integrationRoutes = new Hono<AppContext>();
integrationRoutes.use('*', tenantScope);

interface IntegrationRow {
  key: string;
  provider: string;
  status: string;
  credentials_ciphertext: string | null;
  credentials_iv: string | null;
  connected_as: string | null;
  connected_by: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_sync_result: string | null;
  plan_check_json: string | null;
  // Added by tenant migration 0008. Undefined until a database has it.
  enabled?: number | null;
}

// Every provider an integration row may hold, for request validation.
export const PROVIDERS = ['boulevard', 'housecallpro', 'jobber', 'meta-ads', 'apple-maps-ads'] as const;

// Credentials are write only: the public shape never includes ciphertext,
// IVs, or anything derived from the secret material. state is derived from
// the stored columns (see integrationState.ts) and says what to do next.
function publicShape(row: IntegrationRow, running = false) {
  const described = describeIntegrationState({
    hasCredentials: Boolean(row.credentials_ciphertext),
    status: row.status,
    enabled: row.enabled,
    lastSyncAt: row.last_sync_at,
    lastSyncResult: row.last_sync_result,
    planCheck: row.plan_check_json,
    running,
  });
  return {
    key: row.key,
    provider: row.provider,
    status: row.status,
    enabled: row.enabled !== 0,
    state: described.state,
    stateLabel: described.label,
    stateHint: described.hint,
    connectedAs: row.connected_as,
    connectedAt: row.connected_at,
    lastSyncAt: row.last_sync_at,
    lastSyncResult: row.last_sync_result,
    planCheck: row.plan_check_json ? JSON.parse(row.plan_check_json) : null,
  };
}

// What a thrown sync error says about its cause, for the state above.
// Connectors that classify their failures (Apple Maps) put it on the error.
function failureOf(err: unknown): string {
  const failure = err && typeof err === 'object' ? (err as { failure?: unknown }).failure : undefined;
  return typeof failure === 'string' ? failure : 'error';
}

function dbIdOf(c: { get: (k: 'tenant') => { d1_database_id: string | null } | null }): string {
  const tenant = c.get('tenant');
  if (!tenant?.d1_database_id) throw new Error('tenant database missing');
  return tenant.d1_database_id;
}

export function connectorDbFor(env: Env, databaseId: string): ConnectorDb {
  const d1 = tenantD1Client(env);
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const { results } = await d1.query<T>(databaseId, sql, params);
      return results;
    },
    async batch(statements) {
      await d1.batch(databaseId, statements);
    },
  };
}

export async function loadCredentials(
  env: Env,
  row: IntegrationRow
): Promise<Record<string, string> | null> {
  if (!row.credentials_ciphertext || !row.credentials_iv) return null;
  const plaintext = await decryptCredentials(env.CRED_MASTER_KEY, row.credentials_ciphertext, row.credentials_iv);
  return JSON.parse(plaintext) as Record<string, string>;
}

integrationRoutes.get('/', async (c) => {
  return c.json(await listIntegrations(c.env, dbIdOf(c)));
});

const credsSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    credentials: z.record(z.string().max(60), z.string().max(2048)).refine((r) => Object.keys(r).length <= 10),
  })
  .strict();

integrationRoutes.put('/:key/credentials', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const body = credsSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const result = await saveIntegrationCredentials(c.env, { id: tenant.id, d1_database_id: dbIdOf(c) }, c.req.param('key') ?? '', body.data, {
    actorType: session.userType,
    actorId: session.userId,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  // Only status comes back. Never the credentials.
  return c.json({ ok: true, status: 'disconnected' });
});

integrationRoutes.post('/:key/test', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const result = await testIntegration(c.env, { id: tenant.id, d1_database_id: dbIdOf(c) }, c.req.param('key') ?? '', {
    actorType: session.userType,
    actorId: session.userId,
  });
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

const syncSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).strict();

// Reporting off or back on without touching the credentials, and
// disconnect, which forgets them. Same operations Operations Center uses.
for (const action of ['disable', 'enable', 'disconnect'] as const) {
  integrationRoutes.post(`/:key/${action}`, tenantWrite, async (c) => {
    const tenant = c.get('tenant')!;
    const session = c.get('session')!;
    const result = await setIntegrationEnabled(c.env, { id: tenant.id, d1_database_id: dbIdOf(c) }, c.req.param('key') ?? '', action, {
      actorType: session.userType,
      actorId: session.userId,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result);
  });
}

integrationRoutes.post('/:key/sync', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const body = syncSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const result = await syncIntegration(c.env, { id: tenant.id, d1_database_id: dbIdOf(c) }, c.req.param('key') ?? '', body.data.month, {
    actorType: session.userType,
    actorId: session.userId,
  });
  if (result.ok) return c.json(result);
  return c.json(result.status === 502 ? { ok: false, error: result.error } : { error: result.error }, result.status);
});

/* ------------------------------------------------------------------ */
/* shared with Operations Center's service routes                     */
/* ------------------------------------------------------------------ */
//
// The same operations whichever app asks: the client's own Integrations hub
// above, or Operations Center (routes/service.ts). The caller names who acted.

type Actor = { actorType: 'agency' | 'tenant' | 'system'; actorId: string; actorName?: string };
type TenantDb = { id: string; d1_database_id: string };

export async function listIntegrations(env: Env, databaseId: string) {
  const d1 = tenantD1Client(env);
  const { results } = await d1.query<IntegrationRow>(databaseId, `SELECT * FROM integrations`);
  const requirements = Object.fromEntries(
    Object.entries(CONNECTORS).map(([key, conn]) => [key, conn.getRequirements()])
  );
  // A run still marked running after fifteen minutes died with its Worker,
  // so it does not count. The table arrives with migration 0008; a database
  // without it simply has nothing running.
  const running = new Set<string>();
  try {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { results: runs } = await d1.query<{ integration_key: string }>(
      databaseId,
      `SELECT DISTINCT integration_key FROM ad_platform_sync_runs WHERE status = 'running' AND started_at > ?`,
      [since]
    );
    for (const r of runs) running.add(r.integration_key);
  } catch {
    // not migrated yet
  }
  return { integrations: results.map((r) => publicShape(r, running.has(r.key))), requirements };
}

export async function setIntegrationEnabled(
  env: Env,
  tenant: TenantDb,
  key: string,
  action: 'disable' | 'enable' | 'disconnect',
  actor: Actor
): Promise<{ ok: true; status: string } | { ok: false; status: 404 | 409; error: string }> {
  const d1 = tenantD1Client(env);
  const { results } = await d1.query<IntegrationRow>(tenant.d1_database_id, `SELECT * FROM integrations WHERE key = ?`, [key]);
  const row = results[0];
  if (!row) return { ok: false, status: 404, error: 'not found' };
  if (row.enabled === undefined) {
    return { ok: false, status: 409, error: 'This client’s database needs migrating before reporting can be switched off.' };
  }
  if (action === 'disconnect') {
    // The credentials go. Synced figures stay: they are the client's
    // history. The sync clock resets so a reconnect backfills, and a
    // reconnect to a different account replaces that history (see the
    // connector's scope check).
    await d1.query(
      tenant.d1_database_id,
      `UPDATE integrations SET status = 'disconnected', credentials_ciphertext = NULL, credentials_iv = NULL, connected_as = NULL, plan_check_json = NULL,
         last_sync_at = NULL, last_sync_result = NULL, enabled = 1 WHERE key = ?`,
      [key]
    );
  } else if (action === 'disable') {
    // The sync Worker only reads connected integrations, so this stops it.
    await d1.query(tenant.d1_database_id, `UPDATE integrations SET status = 'disconnected', enabled = 0 WHERE key = ?`, [key]);
  } else {
    // Back on, but unverified until the next Test: credentials may have
    // changed on the platform while reporting was off.
    await d1.query(tenant.d1_database_id, `UPDATE integrations SET enabled = 1 WHERE key = ?`, [key]);
  }
  await writeAudit(env, {
    ...actor,
    tenantId: tenant.id,
    action: `integration.${action}`,
    target: key,
    before: { status: row.status, enabled: row.enabled !== 0 },
  });
  return { ok: true, status: action === 'enable' ? row.status : 'disconnected' };
}

export async function saveIntegrationCredentials(
  env: Env,
  tenant: TenantDb,
  key: string,
  input: { provider: string; credentials: Record<string, string> },
  actor: Actor
): Promise<{ ok: true } | { ok: false; error: string }> {
  const connector = CONNECTORS[input.provider];
  if (!connector) return { ok: false, error: 'unknown provider' };

  const { ciphertext, iv } = await encryptCredentials(env.CRED_MASTER_KEY, JSON.stringify(input.credentials));
  const d1 = tenantD1Client(env);
  await d1.query(
    tenant.d1_database_id,
    `INSERT INTO integrations (key, provider, status, credentials_ciphertext, credentials_iv, connected_by, connected_at)
     VALUES (?, ?, 'disconnected', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (key) DO UPDATE SET provider = excluded.provider,
       credentials_ciphertext = excluded.credentials_ciphertext,
       credentials_iv = excluded.credentials_iv,
       connected_by = excluded.connected_by, connected_at = excluded.connected_at`,
    [key, input.provider, ciphertext, iv, actor.actorId]
  );

  // Seed default stage mappings when none exist for this integration.
  for (const mapping of connector.getRequirements().defaultStageMap) {
    await d1.query(
      tenant.d1_database_id,
      `INSERT OR IGNORE INTO funnel_stage_map (integration_key, external_event, stage) VALUES (?, ?, ?)`,
      [key, mapping.externalEvent, mapping.stage]
    );
  }

  await writeAudit(env, { ...actor, tenantId: tenant.id, action: 'integration.credentials.set', target: key });
  return { ok: true };
}

export async function testIntegration(env: Env, tenant: TenantDb, key: string, actor: Actor) {
  const d1 = tenantD1Client(env);
  const { results } = await d1.query<IntegrationRow>(tenant.d1_database_id, `SELECT * FROM integrations WHERE key = ?`, [key]);
  const row = results[0];
  if (!row) return { error: 'not found', status: 404 as const };
  const connector = CONNECTORS[row.provider];
  if (!connector) return { error: 'unknown provider', status: 400 as const };
  const creds = await loadCredentials(env, row);
  if (!creds) return { error: 'no credentials saved', status: 400 as const };

  // Only LetLois staff are shown every account the credentials reach.
  const result = await connector.testConnection(creds, { discover: actor.actorType !== 'tenant' });
  // Testing a connection whose reporting is switched off checks it without
  // switching it back on: the sync Worker reads connected rows only.
  const status = row.enabled === 0 ? 'disconnected' : result.ok ? 'connected' : 'error';
  // A failed test records what kind of failure it was and when, so the
  // integration's state can say "authentication expired" rather than just
  // "error". A connector's own planCheck wins where it says more.
  const failureKind = result.failure === 'bad_credentials' ? 'auth' : result.failure === 'insufficient_plan' ? 'permission' : 'error';
  const planCheck = result.ok
    ? result.planCheck ?? null
    : { failureKind, checkedAt: new Date().toISOString(), ...(result.planCheck ?? {}) };
  await d1.query(
    tenant.d1_database_id,
    `UPDATE integrations SET status = ?, connected_as = ?, plan_check_json = ? WHERE key = ?`,
    [status, result.connectedAs ?? null, planCheck ? JSON.stringify(planCheck) : null, key]
  );
  await writeAudit(env, {
    ...actor,
    tenantId: tenant.id,
    action: 'integration.test',
    target: key,
    after: { ok: result.ok, failure: result.failure ?? null },
  });
  return {
    ok: result.ok,
    failure: result.failure ?? null,
    message: result.message ?? null,
    connectedAs: result.connectedAs ?? null,
    planCheck: result.planCheck ?? null,
  };
}

export async function syncIntegration(
  env: Env,
  tenant: TenantDb,
  key: string,
  month: string,
  actor: Actor
): Promise<{ ok: true; stats: unknown } | { ok: false; status: 400 | 404 | 409 | 502; error: string }> {
  const d1 = tenantD1Client(env);
  const databaseId = tenant.d1_database_id;
  const { results } = await d1.query<IntegrationRow>(databaseId, `SELECT * FROM integrations WHERE key = ?`, [key]);
  const row = results[0];
  if (!row) return { ok: false, status: 404, error: 'not found' };
  if (row.enabled === 0) return { ok: false, status: 409, error: 'Reporting is disabled for this integration. Enable it first.' };
  const connector = CONNECTORS[row.provider];
  if (!connector) return { ok: false, status: 400, error: 'unknown provider' };
  const creds = await loadCredentials(env, row);
  if (!creds) return { ok: false, status: 400, error: 'no credentials saved' };

  const stageMapRows = await d1.query<{ external_event: string; stage: string }>(
    databaseId,
    `SELECT external_event, stage FROM funnel_stage_map WHERE integration_key = ?`,
    [key]
  );
  const stageMap = new Map(
    stageMapRows.results
      .filter((r) => isFunnelStage(r.stage))
      .map((r) => [r.external_event, r.stage as 'lead' | 'scheduled' | 'completed' | 'purchase'])
  );

  try {
    const stats = await connector.syncMonth(creds, month, connectorDbFor(env, databaseId), key, { stageMap });
    await d1.query(
      databaseId,
      `UPDATE integrations SET status = 'connected', last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_sync_result = ? WHERE key = ?`,
      [JSON.stringify({ ok: true, stats }), key]
    );
    await d1.query(databaseId, `UPDATE sources SET last_import_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?`, [key]);
    await runTenantRollup(env, databaseId, month);
    const ad = stats as Partial<AdSyncStats>;
    // An ad account change purged other months: their rollup goes too.
    for (const other of ad.alsoChanged ?? []) await runTenantRollup(env, databaseId, other);
    // ...and the history for the new account is backfilled by the next run.
    if (ad.restartBackfill) await d1.query(databaseId, `UPDATE integrations SET last_sync_at = NULL WHERE key = ?`, [key]);
    await writeAudit(env, { ...actor, tenantId: tenant.id, action: 'integration.sync', target: `${key}/${month}`, after: stats });
    return { ok: true, stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync failed';
    // A failed sync flips the integration to error and the source red,
    // unless the platform was only busy or unreachable: then it stays
    // connected so the next scheduled sync tries again by itself.
    await d1.query(databaseId, `UPDATE integrations SET status = ?, last_sync_result = ? WHERE key = ?`, [
      isTransientFailure(err) ? row.status : 'error',
      JSON.stringify({ ok: false, error: message, failure: failureOf(err), at: new Date().toISOString() }),
      key,
    ]);
    await writeAudit(env, {
      ...actor,
      tenantId: tenant.id,
      action: 'integration.sync_failed',
      target: `${key}/${month}`,
      after: { failure: failureOf(err) },
    });
    return { ok: false, status: 502, error: message };
  }
}

const stageMapSchema = z
  .object({
    mappings: z
      .array(
        z.object({ externalEvent: z.string().min(1).max(80), stage: z.enum(['lead', 'scheduled', 'completed', 'purchase']) }).strict()
      )
      .max(40),
  })
  .strict();

integrationRoutes.put('/:key/stage-map', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const key = c.req.param('key');
  const body = stageMapSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const d1 = tenantD1Client(c.env);
  const before = await d1.query(dbIdOf(c), `SELECT * FROM funnel_stage_map WHERE integration_key = ?`, [key]);
  await d1.query(dbIdOf(c), `DELETE FROM funnel_stage_map WHERE integration_key = ?`, [key]);
  for (const m of body.data.mappings) {
    await d1.query(
      dbIdOf(c),
      `INSERT INTO funnel_stage_map (integration_key, external_event, stage) VALUES (?, ?, ?)`,
      [key, m.externalEvent, m.stage]
    );
  }
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'integration.stage_map',
    target: key,
    before: before.results,
    after: body.data.mappings,
  });
  return c.json({ ok: true });
});
