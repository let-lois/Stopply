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
// an event or contact row. Every route is GET; there is no write path here.

import { Hono } from 'hono';
import type { AppContext } from '../env';
import { sha256Hex, timingSafeEqualHex } from '../crypto';
import { getTenantById } from '../tenantResolver';
import { tenantD1Client } from '../provisioning';
import { writeAudit } from '../audit';
import type { TenantRow } from '@letlois/db';

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
  if (c.req.method !== 'GET') return c.json({ error: 'method not allowed' }, 405);

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
          `SELECT name, email, role, active, created_at FROM users ORDER BY role, name`
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
