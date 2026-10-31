// The read only API LetLois Operations Center calls server to server.
//
// What is pinned: nothing opens it but the shared token, on the agency host
// (not a dashboard session, not a field token, not a tenant hostname, not a
// short or unset secret); a request naming one tenant reads that tenant's
// database and no other; no credential, ciphertext, or database id ever leaves;
// there is no write path; and the read that names a client's users is audited.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import Database from 'better-sqlite3';
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
// A database Cloudflare has just created: no tables until migrations run.
class EmptyTenantD1 {
  db = new Database(':memory:');
  async query(_id: string, sql: string, params: unknown[] = []) {
    const stmt = this.db.prepare(sql);
    if (stmt.reader) return { results: stmt.all(...params), success: true };
    stmt.run(...params);
    return { results: [], success: true };
  }
  async batch(id: string, statements: Array<{ sql: string; params?: unknown[] }>) {
    const out = [];
    for (const st of statements) out.push(await this.query(id, st.sql, st.params ?? []));
    return out;
  }
}

class PerTenantD1 {
  dbs = new Map<string, SqliteTenantD1 | EmptyTenantD1>();
  opened: string[] = [];
  fail = false;
  of(id: string) {
    if (!this.dbs.has(id)) this.dbs.set(id, id === 'db-newco' ? new EmptyTenantD1() : new SqliteTenantD1());
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
    control.on(/FROM agency_rollup\s+WHERE period_month >=/, () => ({
      results: [
        { tenant_id: ACME.id, period_month: '2026-08', leads: 40, scheduled: 12, completed: 9, purchases: 5, revenue: 8000, spend: 2000, pulled_at: '2026-10-30T09:11:27Z' },
        { tenant_id: RIVAL.id, period_month: '2026-08', leads: 7, scheduled: 1, completed: 1, purchases: 0, revenue: 0, spend: 300, pulled_at: '2026-10-30T09:11:27Z' },
      ],
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
    expect(body.users).toEqual([{ id: 'u1', name: 'Ann Owner', email: 'owner@acme.test', role: 'account_admin', active: true, createdAt: expect.any(String) }]);
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

  it('returns every tenant\'s monthly rollup from the control plane alone, opening no tenant database', async () => {
    const res = await call('/rollup', { headers: bearer() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<Record<string, unknown>> };
    expect(body.rows).toEqual([
      { tenantId: ACME.id, month: '2026-08', leads: 40, scheduled: 12, completed: 9, purchases: 5, revenue: 8000, spend: 2000, pulledAt: '2026-10-30T09:11:27Z' },
      { tenantId: RIVAL.id, month: '2026-08', leads: 7, scheduled: 1, completed: 1, purchases: 0, revenue: 0, spend: 300, pulledAt: '2026-10-30T09:11:27Z' },
    ]);
    expect(tenants.opened).toEqual([]);
    expect(auditRows).toEqual([]);
    expect((await call('/rollup')).status).toBe(401);
    expect((await call('/rollup', { headers: bearer() }, 'acme.bi.letlois.com')).status).toBe(404);
  });

  describe('one month of a tenant', () => {
    beforeEach(async () => {
      const acme = tenants.of('db-acme');
      await acme.query('db-acme', `INSERT INTO monthly_metrics (period_month, channel, attribution_basis, leads, scheduled, completed, purchases, revenue, spend)
        VALUES ('2026-08', 'meta', 'first', 30, 10, 8, 4, 6000, 1500), ('2026-08', 'google', 'first', 10, 2, 1, 1, 2000, 500),
               ('2026-08', 'meta', 'latest', 25, 9, 7, 4, 5000, 1500), ('2026-07', 'meta', 'first', 20, 5, 4, 2, 3000, 1200)`);
      await acme.query('db-acme', `INSERT INTO campaign_metrics (period_month, channel, campaign, spend, leads, completed, revenue)
        VALUES ('2026-08', 'meta', 'Acme spring roofs', 1500, 30, 8, 6000)`);
      await acme.query('db-acme', `INSERT INTO ad_line_items (period_month, channel, campaign, ad_name, spend, leads_reported)
        VALUES ('2026-08', 'meta', 'Acme spring roofs', 'Video A', 900, 20), ('2026-08', 'meta', 'Acme spring roofs', 'Image B', 600, 4)`);
      const rival = tenants.of('db-rival');
      await rival.query('db-rival', `INSERT INTO monthly_metrics (period_month, channel, attribution_basis, leads, scheduled, completed, purchases, revenue, spend)
        VALUES ('2026-08', 'meta', 'first', 777, 0, 0, 0, 0, 7777), ('2026-05', 'meta', 'first', 1, 0, 0, 0, 0, 1)`);
      await rival.query('db-rival', `INSERT INTO campaign_metrics (period_month, channel, campaign, spend, leads, completed, revenue)
        VALUES ('2026-08', 'meta', 'Rival secret campaign', 7777, 777, 0, 0)`);
      tenants.opened = [];
    });

    it("lists that tenant's months only, newest first", async () => {
      const res = await call(`/tenants/${ACME.id}/months`, { headers: bearer() });
      expect(await res.json()).toEqual({ months: ['2026-08', '2026-07'] });
      expect(new Set(tenants.opened)).toEqual(new Set(['db-acme']));
    });

    it("returns the month exactly as the dashboard builds it, from that tenant's database only", async () => {
      const res = await call(`/tenants/${ACME.id}/months/2026-08`, { headers: bearer() });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toMatch(/Rival secret campaign|7777|777/);
      expect(new Set(tenants.opened)).toEqual(new Set(['db-acme']));
      const body = JSON.parse(text);
      expect(body.month).toBe('2026-08');
      expect(body.basis).toBe('first');
      expect(body.channels.map((c: { channel: string }) => c.channel).sort()).toEqual(['google', 'meta']);
      expect(body.campaigns[0]).toMatchObject({ campaign: 'Acme spring roofs', spend: 1500, leads: 30 });
      // The same per ad status the dashboard shows: Video A is cheaper per lead than the campaign.
      const byAd = Object.fromEntries(body.adLineItems.map((a: { ad_name: string; status: string }) => [a.ad_name, a.status]));
      expect(byAd).toEqual({ 'Video A': 'top', 'Image B': 'under' });
    });

    it('serves the latest-touch basis when asked, and the first-touch one otherwise', async () => {
      const latest = await (await call(`/tenants/${ACME.id}/months/2026-08?basis=latest`, { headers: bearer() })).json() as { basis: string; channels: Array<{ leads: number }> };
      expect(latest.basis).toBe('latest');
      expect(latest.channels.map((c) => c.leads)).toEqual([25]);
      const odd = await (await call(`/tenants/${ACME.id}/months/2026-08?basis=anything`, { headers: bearer() })).json() as { basis: string };
      expect(odd.basis).toBe('first');
    });

    it('refuses a malformed month or tenant, and an unauthenticated caller, without opening anything', async () => {
      for (const path of [`/tenants/${ACME.id}/months/2026-8`, `/tenants/${ACME.id}/months/x`, `/tenants/db-acme/months/2026-08`, `/tenants/t_nope/months`]) {
        expect((await call(path, { headers: bearer() })).status).toBe(404);
      }
      expect((await call(`/tenants/${ACME.id}/months/2026-08`)).status).toBe(401);
      expect((await call(`/tenants/${ACME.id}/months/2026-08`, { headers: bearer() }, 'acme.bi.letlois.com')).status).toBe(404);
      expect(tenants.opened).toEqual([]);
    });
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

/* ------------------------------------------------------------------ */
/* writes                                                              */
/* ------------------------------------------------------------------ */

describe('Operations Center service API, writes', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenants: PerTenantD1;
  let auditRows: unknown[][];
  let inserted: unknown[][];
  let cloudflare: { url: string; method: string }[];
  let leftoverDatabase: boolean;

  beforeEach(async () => {
    clearResolverCache();
    tenants = new PerTenantD1();
    auditRows = [];
    inserted = [];
    cloudflare = [];
    leftoverDatabase = false;
    env = makeEnv({ __tenantD1: tenants, OPERATIONS_API_TOKEN: TOKEN });
    const control = env.CONTROL_DB as FakeD1;
    control.on(/FROM tenants WHERE id = \?/, (params) => ({
      first: params[0] === ACME.id ? ACME : params[0] === RIVAL.id ? RIVAL : null,
    }));
    control.on(/FROM tenants WHERE slug = \?/, (params) => ({
      first: params[0] === 'acme' ? ACME : params[0] === 'rival' ? RIVAL : null,
    }));
    control.on(/INSERT INTO tenants/, (params) => {
      inserted.push(params);
      return {};
    });
    control.on(/INSERT OR IGNORE INTO tenant_directory/, () => ({}));
    control.on(/INSERT INTO audit_log/, (params) => {
      auditRows.push(params);
      return {};
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        cloudflare.push({ url, method: init.method ?? 'GET' });
        if (url.includes('/d1/database?name=')) {
          const name = decodeURIComponent(url.split('name=')[1]!);
          return Response.json({ success: true, result: leftoverDatabase ? [{ uuid: 'db-old', name }] : [] });
        }
        if (url.endsWith('/d1/database') && init.method === 'POST') {
          return Response.json({ success: true, result: { uuid: 'db-newco', name: JSON.parse(String(init.body)).name } });
        }
        return new Response('unexpected', { status: 500 });
      })
    );
    await tenants.of('db-acme').query('db-acme', `INSERT INTO users (id, email, name, role, password_hash, active) VALUES ('u_ann', 'ann@acme.test', 'Ann', 'account_admin', 'old-hash', 1)`);
    await tenants.of('db-rival').query('db-rival', `INSERT INTO users (id, email, name, role, password_hash, active) VALUES ('u_boss', 'boss@rival.test', 'Boss', 'account_admin', 'rival-hash', 1)`);
  });
  afterEach(() => vi.unstubAllGlobals());

  const actor = { id: 'usr_sa', name: 'Curtis' };
  const post = (path: string, body: unknown, host = 'bi.letlois.com', token = TOKEN) =>
    app.request(
      `https://${host}/api/service${path}`,
      { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) },
      env as unknown as Env
    );
  type UserRow = { id: string; email: string; role: string; active: number; password_hash: string };
  const usersOf = async (db: string) =>
    (await tenants.of(db).query(db, `SELECT id, email, role, active, password_hash FROM users ORDER BY email`)).results as UserRow[];

  it("creates a client's workspace with its own database and a first admin, and audits it under the person who asked", async () => {
    const res = await post('/tenants', { slug: 'newco', name: 'NewCo Roofing', adminEmail: 'Owner@NewCo.test', adminName: 'Owner', timezone: 'America/Denver', actor });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, string>;
    expect(body).toMatchObject({ slug: 'newco', adminEmail: 'owner@newco.test', dashboardUrl: 'https://newco.bi.letlois.com' });
    expect(body.tempPassword).toMatch(/.{8,}/);
    expect(JSON.stringify(body)).not.toContain('db-newco');
    expect(cloudflare.map((r) => r.method)).toEqual(['GET', 'POST']);
    expect(inserted).toHaveLength(1);
    expect((await usersOf('db-newco')).map((u) => [u.email, u.role])).toEqual([['owner@newco.test', 'account_admin']]);
    const audit = auditRows.find((r) => r[5] === 'tenant.provision')!;
    expect(audit[2]).toBe('ops:usr_sa');
    expect(audit[3]).toBe('operations-center: Curtis');
  });

  it("refuses an address another client has, or a database left behind under it, instead of resuming", async () => {
    expect((await post('/tenants', { slug: 'acme', name: 'Not Acme', adminEmail: 'x@y.test', adminName: 'X', actor })).status).toBe(409);
    expect(cloudflare).toEqual([]);
    leftoverDatabase = true;
    const res = await post('/tenants', { slug: 'oldco', name: 'OldCo', adminEmail: 'x@y.test', adminName: 'X', actor });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'database exists' });
    expect(cloudflare.map((r) => r.method)).toEqual(['GET']);
    expect(inserted).toEqual([]);
  });

  it('refuses a malformed address, a time zone Intl cannot resolve, or a missing actor', async () => {
    for (const body of [
      { slug: 'Bad Slug', name: 'X', adminEmail: 'x@y.test', adminName: 'X', actor },
      { slug: 'ok', name: 'X', adminEmail: 'x@y.test', adminName: 'X', timezone: 'California', actor },
      { slug: 'ok', name: 'X', adminEmail: 'x@y.test', adminName: 'X' },
      { slug: 'ok', name: 'X', adminEmail: 'x@y.test', adminName: 'X', actor, plan: 'whitelabel' },
    ]) {
      expect((await post('/tenants', body)).status).toBe(400);
    }
    expect(cloudflare).toEqual([]);
  });

  it("invites a user into that client's database only", async () => {
    const res = await post(`/tenants/${ACME.id}/users`, { email: 'Viewer@Acme.test', name: 'Vi', role: 'viewer', actor });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; email: string; tempPassword: string };
    expect(body.email).toBe('viewer@acme.test');
    expect(body.tempPassword).toBeTruthy();
    expect((await usersOf('db-acme')).map((u) => u.email)).toEqual(['ann@acme.test', 'viewer@acme.test']);
    expect((await usersOf('db-rival')).map((u) => u.email)).toEqual(['boss@rival.test']);
    expect(auditRows.at(-1)!.slice(2, 7)).toEqual(['ops:usr_sa', 'operations-center: Curtis', ACME.id, 'tenant_user.create', 'viewer@acme.test']);
    expect((await post(`/tenants/${ACME.id}/users`, { email: 'viewer@acme.test', name: 'Again', role: 'viewer', actor })).status).toBe(409);
  });

  it('resets a password and switches access off and on, once each', async () => {
    const reset = await post(`/tenants/${ACME.id}/users/u_ann/reset-password`, { actor });
    expect(reset.status).toBe(200);
    expect((await usersOf('db-acme'))[0]!.password_hash).not.toBe('old-hash');
    expect((await post(`/tenants/${ACME.id}/users/u_ann/deactivate`, { actor })).status).toBe(200);
    expect((await usersOf('db-acme'))[0]!.active).toBe(0);
    expect((await post(`/tenants/${ACME.id}/users/u_ann/deactivate`, { actor })).status).toBe(409);
    // A deactivated account's password is not reset: that would read as giving access back.
    expect((await post(`/tenants/${ACME.id}/users/u_ann/reset-password`, { actor })).status).toBe(404);
    expect((await post(`/tenants/${ACME.id}/users/u_ann/reactivate`, { actor })).status).toBe(200);
    expect((await usersOf('db-acme'))[0]!.active).toBe(1);
    expect(auditRows.map((r) => r[5])).toEqual(['tenant_user.password_reset', 'tenant_user.deactivate', 'tenant_user.reactivate']);
  });

  it("cannot reach one client's user through another client's path", async () => {
    for (const action of ['reset-password', 'deactivate']) {
      expect((await post(`/tenants/${ACME.id}/users/u_boss/${action}`, { actor })).status).toBeGreaterThanOrEqual(404);
    }
    const rival = await usersOf('db-rival');
    expect(rival[0]).toMatchObject({ active: 1, password_hash: 'rival-hash' });
  });

  it('is closed to anyone without the token, on a tenant host, or by another method', async () => {
    expect((await post('/tenants', { slug: 'x', name: 'X', adminEmail: 'x@y.test', adminName: 'X', actor }, 'bi.letlois.com', 'x'.repeat(48))).status).toBe(401);
    expect((await post(`/tenants/${ACME.id}/users`, { email: 'a@b.test', name: 'A', role: 'viewer', actor }, 'acme.bi.letlois.com')).status).toBe(404);
    for (const path of [`/tenants/${ACME.id}/users/u_ann/delete`, `/tenants/${ACME.id}/users/x/deactivate`]) {
      expect((await post(path, { actor })).status).toBe(404);
    }
    const put = await app.request(`https://bi.letlois.com/api/service/tenants/${ACME.id}/users`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` } }, env as unknown as Env);
    expect(put.status).toBe(405);
    expect((await usersOf('db-acme')).map((u) => u.email)).toEqual(['ann@acme.test']);
    expect(cloudflare).toEqual([]);
  });
});
