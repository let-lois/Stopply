import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, FakeKV, makeEnv } from './helpers';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
import type { Env } from '../src/env';

function request(
  env: ReturnType<typeof makeEnv>,
  path: string,
  init: RequestInit = {},
  host = 'bi.letlois.com'
) {
  return app.request(`https://${host}${path}`, init, env as unknown as Env);
}

const TENANT_ROW = {
  id: 't_beclinical',
  slug: 'beclinical',
  name: 'Be Clinical',
  status: 'active',
  plan: 'whitelabel',
  timezone: 'America/Los_Angeles',
  d1_database_id: 'db-1',
  d1_database_name: 'lbi-tenant-beclinical',
  schema_version: 1,
  theme_json: null,
  layout_json: null,
  custom_hostname: 'bi.beclinical.com',
  hostname_status: 'active',
  footer_credit: 1,
  funnel_labels_json: null,
  created_at: '2026-01-01T00:00:00Z',
};

function wireControlDb(db: FakeD1) {
  db.on(/FROM tenants WHERE slug = \?/, (params) => ({
    first: params[0] === 'beclinical' ? TENANT_ROW : null,
  }));
  db.on(/FROM tenants WHERE custom_hostname = \?/, (params) => ({
    first: params[0] === 'bi.beclinical.com' ? TENANT_ROW : null,
  }));
  db.on(/FROM tenants WHERE id = \?/, (params) => ({
    first: params[0] === 't_beclinical' ? TENANT_ROW : null,
  }));
  db.on(/INSERT INTO audit_log/, (params, d) => {
    const rows = d.tables.get('audit_log') ?? [];
    rows.push({ params });
    d.tables.set('audit_log', rows);
    return {};
  });
}

describe('hostname resolution and route gating', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    clearResolverCache();
    env = makeEnv();
    wireControlDb(env.CONTROL_DB as FakeD1);
  });

  it('404s an unknown hostname', async () => {
    const res = await request(env, '/api/health', {}, 'bi.unknown-client.com');
    expect(res.status).toBe(404);
  });

  it('resolves a tenant by slug subdomain', async () => {
    const res = await request(env, '/api/health', {}, 'beclinical.bi.letlois.com');
    expect(res.status).toBe(200);
  });

  it('resolves a tenant by custom hostname', async () => {
    const res = await request(env, '/api/health', {}, 'bi.beclinical.com');
    expect(res.status).toBe(200);
  });

  it('refuses agency routes on a tenant hostname with 404', async () => {
    const res = await request(env, '/api/agency/tenants', {}, 'bi.beclinical.com');
    expect(res.status).toBe(404);
  });

  it('requires auth on agency routes on the agency host', async () => {
    const res = await request(env, '/api/agency/tenants');
    expect(res.status).toBe(401);
  });
});

describe('role enforcement', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    clearResolverCache();
    env = makeEnv();
    wireControlDb(env.CONTROL_DB as FakeD1);
  });

  async function login(role: string, userType: string, tenantId: string | null, assigned: string[] | null = null) {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: userType as 'agency' | 'tenant',
      userId: 'u_test',
      role: role as 'agency_admin',
      tenantId,
      assignedTenants: assigned,
    });
    return { cookie: `lbi_session=${token}`, csrf };
  }

  it('403s a tenant user calling agency routes', async () => {
    const { cookie } = await login('account_admin', 'tenant', 't_beclinical');
    const res = await request(env, '/api/agency/tenants', { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it('403s agency_staff provisioning a tenant (agency_admin only)', async () => {
    const { cookie, csrf } = await login('agency_staff', 'agency', null, ['t_beclinical']);
    const res = await request(env, '/api/agency/tenants', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'x', name: 'X', adminEmail: 'a@b.com', adminName: 'A' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a mutating request without a CSRF token', async () => {
    const { cookie } = await login('agency_admin', 'agency', null);
    const res = await request(env, '/api/agency/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@letlois.com', name: 'New', role: 'agency_staff' }),
    });
    expect(res.status).toBe(403);
  });

  it('403s an agency_staff user switching to an unassigned tenant', async () => {
    const { cookie, csrf } = await login('agency_staff', 'agency', null, ['t_other']);
    const res = await request(env, '/api/auth/switch-tenant', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 't_beclinical' }),
    });
    expect(res.status).toBe(403);
  });

  it('403s a tenant session used on a different tenant host', async () => {
    const { cookie } = await login('account_admin', 'tenant', 't_someoneelse');
    const res = await request(env, '/api/tenant/settings', { headers: { cookie } }, 'bi.beclinical.com');
    expect(res.status).toBe(403);
  });

  it('400s an agency user on tenant routes with no switcher selection', async () => {
    const { cookie } = await login('agency_admin', 'agency', null);
    const res = await request(env, '/api/tenant/settings', { headers: { cookie } });
    expect(res.status).toBe(400);
  });
});

describe('login flow', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    clearResolverCache();
    env = makeEnv();
    wireControlDb(env.CONTROL_DB as FakeD1);
    (env.CONTROL_DB as FakeD1).on(/FROM agency_users WHERE email = \?/, () => ({ first: null }));
    (env.CONTROL_DB as FakeD1).on(/FROM tenant_directory d JOIN tenants t/, (params) => ({
      first:
        params[0] === 'client@beclinical.com'
          ? { slug: 'beclinical', custom_hostname: 'bi.beclinical.com' }
          : null,
    }));
  });

  it('rejects invalid bodies with 400', async () => {
    const res = await request(env, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('redirects a tenant user who tries the agency host to their own domain', async () => {
    const res = await request(env, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'client@beclinical.com', password: 'whatever123' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { redirectHost?: string };
    expect(body.redirectHost).toBe('bi.beclinical.com');
  });

  it('rate limits after 10 attempts per email', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(env, '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'attacker@example.com', password: 'guess' + i }),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
