// The read only API LetLois Operations Center calls server to server.
//
// What is pinned: nothing opens it but the shared token, on the agency host
// (not a dashboard session, not a field token, not a tenant hostname, not a
// short or unset secret); a request naming one tenant reads that tenant's
// database and no other; no credential, ciphertext, or database id ever leaves;
// there is no write path; and the read that names a client's users is audited.

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
import type { Env } from '../src/env';

const TOKEN = 'o'.repeat(48);

function tenantRow(id: string, slug: string, dbId: string | null) {
  return {
    id,
    slug,
    name: slug === 'acme' ? 'Acme Roofing' : 'Rival Pools',
    status: 'active',
    plan: 'pro',
    timezone: 'America/Phoenix',
    d1_database_id: dbId,
    d1_database_name: dbId ? `lbi-tenant-${slug}` : null,
    schema_version: 5,
    theme_json: null,
    layout_json: null,
    custom_hostname: null,
    hostname_status: null,
    footer_credit: 1,
    funnel_labels_json: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const ACME = tenantRow('t_acme01', 'acme', 'db-acme');
const RIVAL = tenantRow('t_rival01', 'rival', 'db-rival');

// One real SQLite database per tenant id, so reading the wrong one shows up
// as the wrong rows rather than passing by accident.
class PerTenantD1 {
  dbs = new Map<string, SqliteTenantD1>();
  opened: string[] = [];
  fail = false;
  of(id: string) {
    if (!this.dbs.has(id)) this.dbs.set(id, new SqliteTenantD1());
    return this.dbs.get(id)!;
  }
  async query(id: string, sql: string, params: unknown[] = []) {
    this.opened.push(id);
    if (this.fail) throw new Error('D1 HTTP API unavailable');
    return this.of(id).query(id, sql, params);
  }
  async batch(id: string, statements: Array<{ sql: string; params?: unknown[] }>) {
    return this.of(id).batch(id, statements);
  }
}

describe('Operations Center service API', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenants: PerTenantD1;
  let auditRows: unknown[][];

  beforeEach(async () => {
    clearResolverCache();
    tenants = new PerTenantD1();
    auditRows = [];
    env = makeEnv({ __tenantD1: tenants, OPERATIONS_API_TOKEN: TOKEN });
    const control = env.CONTROL_DB as FakeD1;
    control.on(/FROM tenants ORDER BY name/, () => ({ results: [ACME, RIVAL] }));
    control.on(/FROM tenants WHERE id = \?/, (params) => ({
      first: params[0] === ACME.id ? ACME : params[0] === RIVAL.id ? RIVAL : null,
    }));
    control.on(/FROM tenants WHERE slug = \?/, (params) => ({
      first: params[0] === 'acme' ? ACME : params[0] === 'rival' ? RIVAL : null,
    }));
    control.on(/FROM agency_rollup WHERE tenant_id = \?/, (params) => ({
      results:
        params[0] === ACME.id
          ? [{ period_month: '2026-08', leads: 40, scheduled: 12, completed: 9, purchases: 5, revenue: 8000, spend: 2000, pulled_at: '2026-10-30T09:11:27Z' }]
          : [{ period_month: '2026-08', leads: 999, scheduled: 0, completed: 0, purchases: 0, revenue: 0, spend: 1, pulled_at: 'rival' }],
    }));
    control.on(/INSERT INTO audit_log/, (params) => {
      auditRows.push(params);
      return {};
    });

    await tenants.of('db-acme').query('db-acme', `INSERT INTO users (id, email, name, role, password_hash) VALUES ('u1', 'owner@acme.test', 'Ann Owner', 'account_admin', 'pbkdf2$secret$hash$value')`);
    await tenants.of('db-acme').query(
      'db-acme',
      `INSERT INTO integrations (key, provider, status, credentials_ciphertext, credentials_iv, connected_at, last_sync_at, last_sync_result)
       VALUES ('meta', 'meta-ads', 'connected', 'CIPHERTEXT-ACME', 'IV-ACME', '2026-09-01T00:00:00Z', '2026-10-30T09:00:00Z', 'ok')`
    );
    await tenants.of('db-rival').query('db-rival', `INSERT INTO users (id, email, name, role, password_hash) VALUES ('u2', 'boss@rival.test', 'Rival Boss', 'account_admin', 'x')`);
  });

  const call = (path: string, init: RequestInit = {}, host = 'bi.letlois.com') =>
    app.request(`https://${host}/api/service${path}`, init, env as unknown as Env);
  const bearer = (token = TOKEN) => ({ authorization: `Bearer ${token}` });

  it('does not exist when the secret is unset or too short to be real', async () => {
    for (const value of [undefined, '', 'short-token']) {
      env = { ...env, OPERATIONS_API_TOKEN: value } as typeof env;
      const res = await call('/tenants', { headers: bearer(value ?? 'x') });
      expect(res.status).toBe(404);
    }
  });

  it('refuses a missing, wrong, or near miss token', async () => {
    for (const headers of [{}, bearer('x'.repeat(48)), bearer(TOKEN.slice(1)), bearer(`${TOKEN}x`), { authorization: TOKEN }, { authorization: `Basic ${TOKEN}` }]) {
      const res = await call('/tenants', { headers });
      expect(res.status).toBe(401);
    }
    expect(tenants.opened).toEqual([]);
  });

  it('is not opened by a dashboard session, even an agency admin one', async () => {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'agency',
      userId: 'u_admin',
      role: 'agency_admin' as never,
      tenantId: null,
      assignedTenants: null,
    });
    const res = await call('/tenants', { headers: { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf } });
    expect(res.status).toBe(401);
  });

  it('answers only on the agency host, never on a tenant hostname', async () => {
    const res = await call(`/tenants/${ACME.id}`, { headers: bearer() }, 'acme.bi.letlois.com');
    expect(res.status).toBe(404);
    expect(tenants.opened).toEqual([]);
  });

  it('lists tenants with names and addresses only', async () => {
    const res = await call('/tenants', { headers: bearer() });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { tenants: Array<Record<string, unknown>> };
    expect(body.tenants.map((t) => t.id)).toEqual([ACME.id, RIVAL.id]);
    expect(body.tenants[0]).toEqual({
      id: ACME.id,
      slug: 'acme',
      name: 'Acme Roofing',
      status: 'active',
      plan: 'pro',
      dashboardUrl: 'https://acme.bi.letlois.com',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(JSON.stringify(body)).not.toMatch(/db-acme|d1_database/);
  });

  it("reads the named tenant's database and no other", async () => {
    const res = await call(`/tenants/${ACME.id}`, { headers: bearer() });
    expect(res.status).toBe(200);
    expect(new Set(tenants.opened)).toEqual(new Set(['db-acme']));
    const text = await res.text();
    expect(text).toContain('owner@acme.test');
    expect(text).not.toContain('boss@rival.test');
    expect(text).not.toContain('999');
    const body = JSON.parse(text);
    expect(body.integrations).toEqual([
      { provider: 'meta-ads', status: 'connected', connectedAt: '2026-09-01T00:00:00Z', lastSyncAt: '2026-10-30T09:00:00Z', lastSyncResult: 'ok' },
    ]);
    expect(body.users).toEqual([{ name: 'Ann Owner', email: 'owner@acme.test', role: 'account_admin', active: true, createdAt: expect.any(String) }]);
    expect(body.rollup[0]).toMatchObject({ month: '2026-08', leads: 40, spend: 2000, revenue: 8000 });
  });

  it('never returns a credential, a password hash, or a database id', async () => {
    const text = await (await call(`/tenants/${ACME.id}`, { headers: bearer() })).text();
    for (const secret of ['CIPHERTEXT-ACME', 'IV-ACME', 'pbkdf2', 'db-acme', 'lbi-tenant-acme', 'credentials']) {
      expect(text).not.toContain(secret);
    }
  });

  it('records the read in the audit log against that tenant', async () => {
    await call(`/tenants/${ACME.id}`, { headers: bearer() });
    expect(auditRows).toHaveLength(1);
    const [, actorType, , actorName, tenantId, action] = auditRows[0]!;
    expect([actorType, actorName, tenantId, action]).toEqual(['system', 'operations-center', ACME.id, 'service.tenant_read']);
  });

  it('is a 404 for an unknown or malformed tenant id, without opening anything', async () => {
    for (const id of ['t_nope', 'db-acme', "t_acme01' OR 1=1--", '..%2Ft_acme01', 'T_ACME01']) {
      const res = await call(`/tenants/${encodeURIComponent(id)}`, { headers: bearer() });
      expect(res.status).toBe(404);
    }
    expect(tenants.opened).toEqual([]);
    expect(auditRows).toEqual([]);
  });

  it('has no write path', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await call(`/tenants/${ACME.id}`, { method, headers: { ...bearer(), 'content-type': 'application/json' }, body: '{}' });
      expect([403, 404, 405]).toContain(res.status);
    }
    expect(tenants.opened).toEqual([]);
  });

  it('still answers with the rollup when the tenant database cannot be read, and says so', async () => {
    tenants.fail = true;
    const res = await call(`/tenants/${ACME.id}`, { headers: bearer() });
    expect(res.status).toBe(200);
    const body = await res.json() as { integrations: unknown; users: unknown; rollup: unknown[] };
    expect(body.integrations).toBeNull();
    expect(body.users).toBeNull();
    expect(body.rollup).toHaveLength(1);
  });
});
