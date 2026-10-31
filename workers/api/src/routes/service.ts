// Read only routes for LetLois Operations Center, called server to server.
//
// Operations Center (the Command Center app) lives in a different Cloudflare
// account, so it cannot bind CONTROL_DB or reach a tenant database itself. It
// asks here instead, over HTTPS, with a shared secret (OPERATIONS_API_TOKEN)
// that only the two Workers hold. Nothing a browser carries can open these
// routes: a dashboard session, a field token, or a tenant hostname all get the
// same answer as a stranger.
//
// What is returned is the least Operations Center needs to show a client's BI
// status: which tenant it is, which integrations are connected and when they
// last synced, who can sign in, and the monthly rollup the sync Worker already
// computes for the agency view. Never a credential, never a database id, never
// an event or contact row.
//
// The writes are the agency's own administration for a client: creating the
// client's BI workspace, managing who can sign in to it, and bringing its data
// in (CSV uploads and integration connections, through the same code the
// client's own screens use). Each names the Operations Center person who
// acted, and is audited under that name.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../env';
import { sha256Hex, timingSafeEqualHex } from '../crypto';
import { getTenantById } from '../tenantResolver';
import { tenantD1Client } from '../provisioning';
import { writeAudit } from '../audit';
import type { TenantRow } from '@letlois/db';
import { monthPayload } from '../monthPayload';
import { z } from 'zod';
import { provisionTenant } from '../provisioning';
import { timezoneField } from './agency';
import { createTenantUser, resetTenantUserPassword, setTenantUserActive } from '../tenantUsers';
import { PARSER_CATALOG, runCsvImport } from './imports';
import { listIntegrations, saveIntegrationCredentials, syncIntegration, testIntegration } from './integrations';

export const serviceRoutes = new Hono<AppContext>();

// Shorter than this is treated as not set, so a placeholder secret can never
// open the routes. Unset means the routes do not exist.
const MIN_TOKEN_LENGTH = 32;

// Tenant ids are minted as t_ plus hex. Anything else is not worth a lookup.
const TENANT_ID = /^t_[a-z0-9]{1,64}$/;

// Hashed first so the comparison takes the same time whatever the lengths.
async function sameSecret(supplied: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(supplied), sha256Hex(expected)]);
  return timingSafeEqualHex(a, b);
}

serviceRoutes.use('*', async (c, next) => {
  // Only on the agency host: a tenant hostname answers for one client, and
  // this API is about all of them.
  if (c.get('hostContext') !== 'agency') return c.json({ error: 'not found' }, 404);
  const expected = c.env.OPERATIONS_API_TOKEN ?? '';
  if (expected.length < MIN_TOKEN_LENGTH) return c.json({ error: 'not found' }, 404);

  const header = c.req.header('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!supplied || !(await sameSecret(supplied, expected))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  // GET reads, and POST for the few writes below. Nothing else exists here.
  if (c.req.method !== 'GET' && c.req.method !== 'POST') return c.json({ error: 'method not allowed' }, 405);

  await next();
  c.header('cache-control', 'no-store');
});

function dashboardUrl(env: AppContext['Bindings'], tenant: Pick<TenantRow, 'slug' | 'custom_hostname' | 'hostname_status'>): string {
  if (tenant.custom_hostname && tenant.hostname_status === 'active') return `https://${tenant.custom_hostname}`;
  return `https://${tenant.slug}${env.TENANT_HOST_SUFFIX}`;
}

// Every tenant, for Operations Center to link its companies to. Names and
// addresses only.
serviceRoutes.get('/tenants', async (c) => {
  const { results } = await c.env.CONTROL_DB.prepare(
    `SELECT id, slug, name, status, plan, custom_hostname, hostname_status, created_at
     FROM tenants ORDER BY name`
  ).all<Pick<TenantRow, 'id' | 'slug' | 'name' | 'status' | 'plan' | 'custom_hostname' | 'hostname_status' | 'created_at'>>();
  return c.json({
    tenants: results.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      plan: t.plan,
      dashboardUrl: dashboardUrl(c.env, t),
      createdAt: t.created_at,
    })),
  });
});

interface IntegrationRow {
  provider: string;
  status: string;
  connected_at: string | null;
  last_sync_at: string | null;
  last_sync_result: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: number;
  created_at: string;
}

interface RollupRow {
  period_month: string;
  leads: number;
  scheduled: number;
  completed: number;
  purchases: number;
  revenue: number;
  spend: number;
  pulled_at: string;
}

// One tenant's status. The tenant database is read by the id resolved here
// from the control plane, never by anything in the request, so a path naming
// one tenant can only ever open that tenant's database.
serviceRoutes.get('/tenants/:id', async (c) => {
  const id = c.req.param('id');
  if (!TENANT_ID.test(id)) return c.json({ error: 'not found' }, 404);
  const tenant = await getTenantById(c.env, id);
  if (!tenant) return c.json({ error: 'not found' }, 404);

  const { results: rollup } = await c.env.CONTROL_DB.prepare(
    `SELECT period_month, leads, scheduled, completed, purchases, revenue, spend, pulled_at
     FROM agency_rollup WHERE tenant_id = ? ORDER BY period_month DESC LIMIT 12`
  )
    .bind(tenant.id)
    .all<RollupRow>();

  // The tenant database sits behind the D1 HTTP API, which can be slow or down
  // on its own. Say so rather than fail the whole answer: the rollup above is
  // still worth showing.
  let integrations: IntegrationRow[] | null = null;
  let users: UserRow[] | null = null;
  if (tenant.d1_database_id) {
    try {
      const d1 = tenantD1Client(c.env);
      const [i, u] = await Promise.all([
        d1.query<IntegrationRow>(
          tenant.d1_database_id,
          `SELECT provider, status, connected_at, last_sync_at, last_sync_result FROM integrations ORDER BY provider`
        ),
        d1.query<UserRow>(
          tenant.d1_database_id,
          `SELECT id, name, email, role, active, created_at FROM users ORDER BY role, name`
        ),
      ]);
      integrations = i.results;
      users = u.results;
    } catch {
      integrations = null;
      users = null;
    }
  }

  // It names who can sign in to a client's dashboard, so the read is recorded
  // the same way an agency user opening that tenant is.
  await writeAudit(c.env, {
    actorType: 'system',
    actorName: 'operations-center',
    tenantId: tenant.id,
    action: 'service.tenant_read',
    target: tenant.id,
  });

  return c.json({
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      plan: tenant.plan,
      timezone: tenant.timezone,
      dashboardUrl: dashboardUrl(c.env, tenant),
      createdAt: tenant.created_at,
    },
    // Null when the tenant database could not be read, as opposed to empty.
    integrations:
      integrations?.map((r) => ({
        provider: r.provider,
        status: r.status,
        connectedAt: r.connected_at,
        lastSyncAt: r.last_sync_at,
        lastSyncResult: r.last_sync_result,
      })) ?? null,
    users:
      users?.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active === 1,
        createdAt: u.created_at,
      })) ?? null,
    rollup: rollup.map((r) => ({
      month: r.period_month,
      leads: r.leads,
      scheduled: r.scheduled,
      completed: r.completed,
      purchases: r.purchases,
      revenue: r.revenue,
      spend: r.spend,
      pulledAt: r.pulled_at,
    })),
  });
});

// Every tenant's monthly rollup in one answer, for Operations Center's
// cross-client overview. Read from the control plane only: no tenant database
// is opened and no user is named, so unlike a single tenant read there is
// nothing here to audit. Bounded to the last 13 months.
serviceRoutes.get('/rollup', async (c) => {
  const { results } = await c.env.CONTROL_DB.prepare(
    `SELECT tenant_id, period_month, leads, scheduled, completed, purchases, revenue, spend, pulled_at
     FROM agency_rollup
     WHERE period_month >= strftime('%Y-%m', 'now', 'start of month', '-12 months')
     ORDER BY tenant_id, period_month DESC`
  ).all<RollupRow & { tenant_id: string }>();
  return c.json({
    rows: results.map((r) => ({
      tenantId: r.tenant_id,
      month: r.period_month,
      leads: r.leads,
      scheduled: r.scheduled,
      completed: r.completed,
      purchases: r.purchases,
      revenue: r.revenue,
      spend: r.spend,
      pulledAt: r.pulled_at,
    })),
  });
});

const MONTH = /^\d{4}-\d{2}$/;

// The tenant a path names, resolved from the control plane, with its database.
// Null for a malformed id, an unknown tenant, or one with no database yet.
async function tenantDatabase(c: Context<AppContext>): Promise<{ tenant: TenantRow; database: string } | null> {
  const id = c.req.param('id') ?? '';
  if (!TENANT_ID.test(id)) return null;
  const tenant = await getTenantById(c.env, id);
  if (!tenant?.d1_database_id) return null;
  return { tenant, database: tenant.d1_database_id };
}

// Months that have figures, newest first, for a month picker.
serviceRoutes.get('/tenants/:id/months', async (c) => {
  const found = await tenantDatabase(c);
  if (!found) return c.json({ error: 'not found' }, 404);
  const { results } = await tenantD1Client(c.env).query<{ period_month: string }>(
    found.database,
    `SELECT DISTINCT period_month FROM monthly_metrics ORDER BY period_month DESC`
  );
  return c.json({ months: results.map((r) => r.period_month) });
});

// One month of the tenant's dashboard, exactly as the dashboard itself builds
// it (monthPayload), unrestricted because the reader is the agency. Aggregates
// only: no contact, event or user row is in it, so it is not audited.
serviceRoutes.get('/tenants/:id/months/:month', async (c) => {
  const month = c.req.param('month');
  if (!MONTH.test(month)) return c.json({ error: 'not found' }, 404);
  const found = await tenantDatabase(c);
  if (!found) return c.json({ error: 'not found' }, 404);
  const basis = c.req.query('basis') === 'latest' ? 'latest' : 'first';
  return c.json(await monthPayload(c.env, found.database, month, basis, null));
});

/* ------------------------------------------------------------------ */
/* writes: a client's workspace and who can sign in to it             */
/* ------------------------------------------------------------------ */

// Who in Operations Center asked. Recorded, not trusted for anything else:
// the shared token is what authorises the call.
const actorSchema = z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(160) }).strict();

function asActor(actor: z.infer<typeof actorSchema>) {
  return { actorType: 'system' as const, actorId: `ops:${actor.id}`, actorName: `operations-center: ${actor.name}` };
}

const createTenantSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/),
    name: z.string().min(1).max(120),
    adminEmail: z.string().email().max(254),
    adminName: z.string().min(1).max(120),
    timezone: timezoneField.optional(),
    actor: actorSchema,
  })
  .strict();

// A new client workspace: its own database, the default sources, and a first
// client admin whose temporary password comes back exactly once.
//
// Unlike the console's provisioning, an address that is already taken is
// refused rather than resumed: from here, a typo matching another client's
// address would otherwise add a stranger as that client's admin.
serviceRoutes.post('/tenants', async (c) => {
  const body = createTenantSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const taken = await c.env.CONTROL_DB.prepare(`SELECT id FROM tenants WHERE slug = ?`).bind(body.data.slug).first();
  if (taken) return c.json({ error: 'slug taken' }, 409);
  // provisionTenant reuses a database that already has this client's name,
  // which is right for a console retry and wrong here: a database left behind
  // by an earlier client still holds that client's users.
  const leftover = await databaseNamed(c.env, `lbi-tenant-${body.data.slug}`);
  if (leftover === null) return c.json({ error: 'provisioning failed' }, 502);
  if (leftover) return c.json({ error: 'database exists' }, 409);
  const actor = asActor(body.data.actor);
  try {
    const result = await provisionTenant(c.env, {
      slug: body.data.slug,
      name: body.data.name,
      adminEmail: body.data.adminEmail,
      adminName: body.data.adminName,
      timezone: body.data.timezone,
      actor: { id: actor.actorId, name: actor.actorName },
    });
    return c.json(
      {
        tenantId: result.tenantId,
        slug: result.slug,
        adminEmail: result.adminEmail,
        tempPassword: result.tempPassword,
        dashboardUrl: `https://${result.slug}${c.env.TENANT_HOST_SUFFIX}`,
      },
      201
    );
  } catch {
    return c.json({ error: 'provisioning failed' }, 502);
  }
});

// Whether a D1 database with this exact name exists in the account. Null when
// Cloudflare could not be asked, so the caller refuses rather than guesses.
async function databaseNamed(env: AppContext['Bindings'], name: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database?name=${encodeURIComponent(name)}`,
      { headers: { authorization: `Bearer ${env.CF_API_TOKEN}` } }
    );
    const json = (await res.json()) as { success?: boolean; result?: Array<{ name: string }> };
    if (!json.success || !Array.isArray(json.result)) return null;
    return json.result.some((d) => d.name === name);
  } catch {
    return null;
  }
}

const inviteSchema = z
  .object({
    email: z.string().email().max(254),
    name: z.string().min(1).max(120),
    role: z.enum(['account_admin', 'viewer']),
    actor: actorSchema,
  })
  .strict();

serviceRoutes.post('/tenants/:id/users', async (c) => {
  const found = await tenantDatabase(c);
  if (!found) return c.json({ error: 'not found' }, 404);
  const body = inviteSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const created = await createTenantUser(
    c.env,
    { id: found.tenant.id, d1_database_id: found.database },
    { email: body.data.email, name: body.data.name, role: body.data.role }
  );
  if (!created.ok) return c.json({ error: 'email already exists' }, 409);
  await writeAudit(c.env, {
    ...asActor(body.data.actor),
    tenantId: found.tenant.id,
    action: 'tenant_user.create',
    target: created.email,
    after: { id: created.id, role: body.data.role },
  });
  return c.json({ id: created.id, email: created.email, tempPassword: created.tempPassword }, 201);
});

const USER_ID = /^u_[a-z0-9]{1,64}$/;
const actorOnly = z.object({ actor: actorSchema }).strict();

serviceRoutes.post('/tenants/:id/users/:userId/:action', async (c) => {
  const action = c.req.param('action');
  const userId = c.req.param('userId');
  if (!['reset-password', 'deactivate', 'reactivate'].includes(action) || !USER_ID.test(userId)) {
    return c.json({ error: 'not found' }, 404);
  }
  const found = await tenantDatabase(c);
  if (!found) return c.json({ error: 'not found' }, 404);
  const body = actorOnly.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const actor = asActor(body.data.actor);

  if (action === 'reset-password') {
    const reset = await resetTenantUserPassword(c.env, found.database, userId);
    if (!reset.ok) return c.json({ error: 'not found' }, 404);
    await writeAudit(c.env, { ...actor, tenantId: found.tenant.id, action: 'tenant_user.password_reset', target: reset.email });
    return c.json({ id: userId, email: reset.email, tempPassword: reset.tempPassword });
  }

  const active = action === 'reactivate';
  const changed = await setTenantUserActive(c.env, found.database, userId, active);
  if (!changed.ok) return c.json({ error: 'no change' }, 409);
  await writeAudit(c.env, {
    ...actor,
    tenantId: found.tenant.id,
    action: active ? 'tenant_user.reactivate' : 'tenant_user.deactivate',
    target: changed.email,
  });
  return c.json({ id: userId, email: changed.email, active });
});

/* ------------------------------------------------------------------ */
/* data in: CSV uploads and integration connections                    */
/* ------------------------------------------------------------------ */
//
// The same operations the client's own Data and Team and Integrations
// screens run (runCsvImport, saveIntegrationCredentials, testIntegration,
// syncIntegration), so an upload or a connection behaves the same whichever
// app it came through. Credentials are write only here too: nothing below
// ever returns one, or anything derived from one.

const SOURCE_KEY = /^[a-z0-9-]{1,60}$/;
const MAX_CSV_BYTES = 10 * 1024 * 1024;

// Where the client's data comes from, what can be uploaded, and recent uploads.
serviceRoutes.get('/tenants/:id/sources', async (c) => {
  const found = await tenantDatabase(c);
  if (!found) return c.json({ error: 'not found' }, 404);
  const d1 = tenantD1Client(c.env);
  const [sources, imports] = await Promise.all([
    d1.query<{ key: string; name: string; kind: string; connector_type: string | null; last_import_at: string | null; records_through: string | null; verified_at: string | null }>(
      found.database,
      `SELECT key, name, kind, connector_type, last_import_at, records_through, verified_at FROM sources ORDER BY name`
    ),
    d1.query<{ id: string; source_key: string; period_month: string; row_count: number; records_from: string | null; records_through: string | null; uploaded_at: string }>(
      found.database,
      `SELECT id, source_key, period_month, row_count, records_from, records_through, uploaded_at FROM csv_imports ORDER BY uploaded_at DESC LIMIT 50`
    ),
  ]);
  return c.json({
    sources: sources.results.map((s) => ({
      key: s.key,
      name: s.name,
      kind: s.kind,
      connectorType: s.connector_type,
      lastImportAt: s.last_import_at,
      recordsThrough: s.records_through,
      verified: s.verified_at !== null,
    })),
    parsers: Object.entries(PARSER_CATALOG).map(([key, description]) => ({ key, description })),
    imports: imports.results.map((i) => ({
      id: i.id,
      sourceKey: i.source_key,
      month: i.period_month,
      rowCount: i.row_count,
      recordsFrom: i.records_from,
      recordsThrough: i.records_through,
      uploadedAt: i.uploaded_at,
    })),
  });
});

// A CSV upload. The file is the raw request body rather than a JSON field, so
// Operations Center can pass it on without re-encoding megabytes of text; who
// asked travels in two headers instead.
serviceRoutes.post('/tenants/:id/imports', async (c) => {
  const found = await tenantDatabase(c);
  if (!found) return c.json({ error: 'not found' }, 404);
  const sourceKey = c.req.query('source') ?? '';
  const month = c.req.query('month') ?? '';
  const parser = c.req.query('parser') || undefined;
  const actor = actorSchema.safeParse({ id: c.req.header('x-ops-actor-id') ?? '', name: c.req.header('x-ops-actor-name') ?? '' });
  if (!SOURCE_KEY.test(sourceKey) || !MONTH.test(month) || (parser !== undefined && !/^[a-z0-9-]{1,40}$/.test(parser)) || !actor.success) {
    return c.json({ error: 'invalid request' }, 400);
  }
  if (Number(c.req.header('content-length') ?? 0) > MAX_CSV_BYTES) return c.json({ error: 'file too large' }, 413);
  const csv = await c.req.text();
  if (!csv || csv.length > MAX_CSV_BYTES) return c.json({ error: csv ? 'file too large' : 'invalid request' }, csv ? 413 : 400);

  const result = await runCsvImport(
    c.env,
    { id: found.tenant.id, slug: found.tenant.slug, d1_database_id: found.database },
    { sourceKey, month, csv, parser },
    asActor(actor.data)
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  const { ok: _ok, ...summary } = result;
  return c.json({ ok: true, ...summary }, 201);
});

// What is connected, and what each connector asks for (field labels, which
// fields are secret, the setup guide). Never the credentials.
serviceRoutes.get('/tenants/:id/integrations', async (c) => {
  const found = await tenantDatabase(c);
  if (!found) return c.json({ error: 'not found' }, 404);
  return c.json(await listIntegrations(c.env, found.database));
});

const credentialsSchema = z
  .object({
    provider: z.enum(['boulevard', 'housecallpro', 'jobber', 'meta-ads']),
    credentials: z.record(z.string().max(60), z.string().max(2048)).refine((r) => Object.keys(r).length <= 10),
    actor: actorSchema,
  })
  .strict();

serviceRoutes.post('/tenants/:id/integrations/:key/:action', async (c) => {
  const key = c.req.param('key');
  const action = c.req.param('action');
  if (!SOURCE_KEY.test(key) || !['credentials', 'test', 'sync'].includes(action)) return c.json({ error: 'not found' }, 404);
  const found = await tenantDatabase(c);
  if (!found) return c.json({ error: 'not found' }, 404);
  const tenant = { id: found.tenant.id, d1_database_id: found.database };
  const raw = await c.req.json().catch(() => null);

  if (action === 'credentials') {
    const body = credentialsSchema.safeParse(raw);
    if (!body.success) return c.json({ error: 'invalid request' }, 400);
    const saved = await saveIntegrationCredentials(c.env, tenant, key, body.data, asActor(body.data.actor));
    if (!saved.ok) return c.json({ error: saved.error }, 400);
    return c.json({ ok: true, status: 'disconnected' });
  }

  if (action === 'test') {
    const body = actorOnly.safeParse(raw);
    if (!body.success) return c.json({ error: 'invalid request' }, 400);
    const result = await testIntegration(c.env, tenant, key, asActor(body.data.actor));
    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.json(result);
  }

  const body = z.object({ month: z.string().regex(MONTH), actor: actorSchema }).strict().safeParse(raw);
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const result = await syncIntegration(c.env, tenant, key, body.data.month, asActor(body.data.actor));
  if (!result.ok) return c.json({ ok: false, error: result.error }, result.status);
  return c.json(result);
});
