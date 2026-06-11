import { Hono } from 'hono';
import { z } from 'zod';
import { CONNECTORS, type ConnectorDb } from '@letlois/connectors';
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
}

// Credentials are write only: the public shape never includes ciphertext,
// IVs, or anything derived from the secret material.
function publicShape(row: IntegrationRow) {
  return {
    key: row.key,
    provider: row.provider,
    status: row.status,
    connectedAs: row.connected_as,
    connectedAt: row.connected_at,
    lastSyncAt: row.last_sync_at,
    lastSyncResult: row.last_sync_result,
    planCheck: row.plan_check_json ? JSON.parse(row.plan_check_json) : null,
  };
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
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<IntegrationRow>(dbIdOf(c), `SELECT * FROM integrations`);
  const requirements = Object.fromEntries(
    Object.entries(CONNECTORS).map(([key, conn]) => [key, conn.getRequirements()])
  );
  return c.json({ integrations: results.map(publicShape), requirements });
});

const credsSchema = z
  .object({
    provider: z.enum(['boulevard', 'housecallpro', 'jobber']),
    credentials: z.record(z.string().max(60), z.string().max(2048)).refine((r) => Object.keys(r).length <= 10),
  })
  .strict();

integrationRoutes.put('/:key/credentials', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const key = c.req.param('key');
  const body = credsSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const connector = CONNECTORS[body.data.provider];
  if (!connector) return c.json({ error: 'unknown provider' }, 400);

  const { ciphertext, iv } = await encryptCredentials(
    c.env.CRED_MASTER_KEY,
    JSON.stringify(body.data.credentials)
  );
  const d1 = tenantD1Client(c.env);
  await d1.query(
    dbIdOf(c),
    `INSERT INTO integrations (key, provider, status, credentials_ciphertext, credentials_iv, connected_by, connected_at)
     VALUES (?, ?, 'disconnected', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (key) DO UPDATE SET provider = excluded.provider,
       credentials_ciphertext = excluded.credentials_ciphertext,
       credentials_iv = excluded.credentials_iv,
       connected_by = excluded.connected_by, connected_at = excluded.connected_at`,
    [key, body.data.provider, ciphertext, iv, session.userId]
  );

  // Seed default stage mappings when none exist for this integration.
  for (const mapping of connector.getRequirements().defaultStageMap) {
    await d1.query(
      dbIdOf(c),
      `INSERT OR IGNORE INTO funnel_stage_map (integration_key, external_event, stage) VALUES (?, ?, ?)`,
      [key, mapping.externalEvent, mapping.stage]
    );
  }

  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'integration.credentials.set',
    target: key,
  });
  // Only status comes back. Never the credentials.
  return c.json({ ok: true, status: 'disconnected' });
});

integrationRoutes.post('/:key/test', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const key = c.req.param('key');
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<IntegrationRow>(dbIdOf(c), `SELECT * FROM integrations WHERE key = ?`, [key]);
  const row = results[0];
  if (!row) return c.json({ error: 'not found' }, 404);
  const connector = CONNECTORS[row.provider];
  if (!connector) return c.json({ error: 'unknown provider' }, 400);
  const creds = await loadCredentials(c.env, row);
  if (!creds) return c.json({ error: 'no credentials saved' }, 400);

  const result = await connector.testConnection(creds);
  const status = result.ok ? 'connected' : 'error';
  await d1.query(
    dbIdOf(c),
    `UPDATE integrations SET status = ?, connected_as = ?, plan_check_json = ? WHERE key = ?`,
    [status, result.connectedAs ?? null, result.planCheck ? JSON.stringify(result.planCheck) : null, key]
  );
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'integration.test',
    target: key,
    after: { ok: result.ok, failure: result.failure ?? null },
  });
  return c.json({
    ok: result.ok,
    failure: result.failure ?? null,
    message: result.message ?? null,
    connectedAs: result.connectedAs ?? null,
    planCheck: result.planCheck ?? null,
  });
});

const syncSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).strict();

integrationRoutes.post('/:key/sync', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const key = c.req.param('key') ?? '';
  const body = syncSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const d1 = tenantD1Client(c.env);
  const databaseId = dbIdOf(c);
  const { results } = await d1.query<IntegrationRow>(databaseId, `SELECT * FROM integrations WHERE key = ?`, [key]);
  const row = results[0];
  if (!row) return c.json({ error: 'not found' }, 404);
  const connector = CONNECTORS[row.provider];
  if (!connector) return c.json({ error: 'unknown provider' }, 400);
  const creds = await loadCredentials(c.env, row);
  if (!creds) return c.json({ error: 'no credentials saved' }, 400);

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
    const stats = await connector.syncMonth(creds, body.data.month, connectorDbFor(c.env, databaseId), key, {
      stageMap,
    });
    await d1.query(
      databaseId,
      `UPDATE integrations SET status = 'connected', last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_sync_result = ? WHERE key = ?`,
      [JSON.stringify({ ok: true, stats }), key]
    );
    await d1.query(
      databaseId,
      `UPDATE sources SET last_import_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?`,
      [key]
    );
    await runTenantRollup(c.env, databaseId, body.data.month);
    await writeAudit(c.env, {
      actorType: session.userType,
      actorId: session.userId,
      tenantId: tenant.id,
      action: 'integration.sync',
      target: `${key}/${body.data.month}`,
      after: stats,
    });
    return c.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync failed';
    // A failed sync flips the integration to error and the source red.
    await d1.query(
      databaseId,
      `UPDATE integrations SET status = 'error', last_sync_result = ? WHERE key = ?`,
      [JSON.stringify({ ok: false, error: message }), key]
    );
    return c.json({ ok: false, error: message }, 502);
  }
});

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
