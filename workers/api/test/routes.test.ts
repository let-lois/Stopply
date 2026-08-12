import { describe, it, expect, beforeEach } from 'vitest';
import { LETLOIS_THEME } from '@letlois/db';
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

  it('403s agency_staff editing a client budget (agency_admin only)', async () => {
    const { cookie, csrf } = await login('agency_staff', 'agency', null, ['t_beclinical']);
    const res = await request(env, '/api/agency/tenants/t_beclinical/budget', {
      method: 'PUT',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ monthlyAdSpendBudget: 28500, adPlatforms: ['meta', 'google'] }),
    });
    expect(res.status).toBe(403);
  });

  it('lets agency_admin set a client budget and platform mix', async () => {
    const writes: unknown[][] = [];
    (env.CONTROL_DB as FakeD1).on(/UPDATE tenants SET monthly_ad_spend_budget/, (params) => {
      writes.push(params);
      return {};
    });
    const { cookie, csrf } = await login('agency_admin', 'agency', null);
    const res = await request(env, '/api/agency/tenants/t_beclinical/budget', {
      method: 'PUT',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ monthlyAdSpendBudget: 28500, adPlatforms: ['meta', 'google'] }),
    });
    expect(res.status).toBe(200);
    expect(writes).toEqual([[28500, JSON.stringify(['meta', 'google']), null, 't_beclinical']]);
  });

  it('lets agency_admin set a per platform budget split', async () => {
    const writes: unknown[][] = [];
    (env.CONTROL_DB as FakeD1).on(/UPDATE tenants SET monthly_ad_spend_budget/, (params) => {
      writes.push(params);
      return {};
    });
    const { cookie, csrf } = await login('agency_admin', 'agency', null);
    const res = await request(env, '/api/agency/tenants/t_beclinical/budget', {
      method: 'PUT',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({
        monthlyAdSpendBudget: 28500,
        adPlatforms: ['meta', 'google'],
        platformBudgets: { meta: 19000, google: 9500 },
      }),
    });
    expect(res.status).toBe(200);
    expect(writes).toEqual([
      [28500, JSON.stringify(['meta', 'google']), JSON.stringify({ meta: 19000, google: 9500 }), 't_beclinical'],
    ]);
  });

  it('404s a budget edit for an unknown tenant', async () => {
    const { cookie, csrf } = await login('agency_admin', 'agency', null);
    const res = await request(env, '/api/agency/tenants/t_nope/budget', {
      method: 'PUT',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ monthlyAdSpendBudget: 1000, adPlatforms: ['meta'] }),
    });
    expect(res.status).toBe(404);
  });

  it('400s an invalid budget payload', async () => {
    const { cookie, csrf } = await login('agency_admin', 'agency', null);
    const res = await request(env, '/api/agency/tenants/t_beclinical/budget', {
      method: 'PUT',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ monthlyAdSpendBudget: -1, adPlatforms: ['meta'] }),
    });
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

// Provisioning used to stamp LETLOIS_THEME onto every tenant. A theme is
// applied as inline CSS variables, which outrank the dark palette, so a
// tenant carrying that light default rendered its dark ink over the dark
// sidebar (not a theme token) and the nav was unreadable. GET /settings
// reports an untouched default as no theme so the shell falls back to the
// app palette; a real brand theme still comes through.
describe('tenant settings theme', () => {
  let env: ReturnType<typeof makeEnv>;

  // Wires the tenant lookups directly rather than going through
  // wireControlDb: FakeD1 runs the first handler whose pattern matches, so a
  // later registration for the same query would never fire.
  function wireWithTheme(themeJson: string | null) {
    const row = { ...TENANT_ROW, theme_json: themeJson };
    const db = env.CONTROL_DB as FakeD1;
    db.on(/FROM tenants WHERE slug = \?/, (params) => ({ first: params[0] === 'beclinical' ? row : null }));
    db.on(/FROM tenants WHERE id = \?/, (params) => ({ first: params[0] === 't_beclinical' ? row : null }));
  }

  async function getSettings() {
    const { token } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_test',
      role: 'account_admin',
      tenantId: 't_beclinical',
      assignedTenants: null,
    });
    const res = await request(
      env,
      '/api/tenant/settings',
      { headers: { cookie: `lbi_session=${token}` } },
      'beclinical.bi.letlois.com'
    );
    return (await res.json()) as { tenant: { theme: Record<string, string> | null } };
  }

  beforeEach(() => {
    clearResolverCache();
    env = makeEnv();
  });

  it('reports the untouched provisioning default as no theme', async () => {
    wireWithTheme(JSON.stringify(LETLOIS_THEME));
    const body = await getSettings();
    expect(body.tenant.theme).toBeNull();
  });

  it('still reports a theme with a genuinely customized color', async () => {
    wireWithTheme(JSON.stringify({ ...LETLOIS_THEME, accent: '#8A1538' }));
    const body = await getSettings();
    expect(body.tenant.theme?.accent).toBe('#8A1538');
  });

  it('treats default colors plus custom CSS as a real theme', async () => {
    wireWithTheme(JSON.stringify({ ...LETLOIS_THEME, customCss: '.card { border-radius: 0 }' }));
    const body = await getSettings();
    expect(body.tenant.theme).not.toBeNull();
  });

  it('reports no theme when the tenant has none stored', async () => {
    wireWithTheme(null);
    const body = await getSettings();
    expect(body.tenant.theme).toBeNull();
  });
});

// Admin driven password reset. There is no email provider bound to the
// Worker, so reset is something an admin performs on a user's behalf; these
// pin the authorization boundary and the shown-once response.
describe('password reset', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    clearResolverCache();
    env = makeEnv();
    wireControlDb(env.CONTROL_DB as FakeD1);
  });

  async function login(role: string, userType: string, tenantId: string | null) {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: userType as 'agency' | 'tenant',
      userId: 'u_test',
      role: role as 'agency_admin',
      tenantId,
      assignedTenants: null,
    });
    return { cookie: `lbi_session=${token}`, csrf };
  }

  it('lets agency_admin reset an agency user and returns the password once', async () => {
    const writes: unknown[][] = [];
    (env.CONTROL_DB as FakeD1).on(/SELECT id, email FROM agency_users WHERE id = \?/, (params) => ({
      first: params[0] === 'au_1' ? { id: 'au_1', email: 'staff@letlois.com' } : null,
    }));
    (env.CONTROL_DB as FakeD1).on(/UPDATE agency_users SET password_hash/, (params) => {
      writes.push(params);
      return {};
    });
    const { cookie, csrf } = await login('agency_admin', 'agency', null);
    const res = await request(env, '/api/agency/users/au_1/reset-password', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; tempPassword: string };
    expect(body.email).toBe('staff@letlois.com');
    expect(body.tempPassword).toBeTruthy();
    // The stored value is a hash, never the password that was handed back.
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).not.toBe(body.tempPassword);
  });

  it('403s agency_staff resetting an agency user (agency_admin only)', async () => {
    const { cookie, csrf } = await login('agency_staff', 'agency', null);
    const res = await request(env, '/api/agency/users/au_1/reset-password', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('404s an unknown or deactivated agency user', async () => {
    (env.CONTROL_DB as FakeD1).on(/SELECT id, email FROM agency_users WHERE id = \?/, () => ({
      first: null,
    }));
    const { cookie, csrf } = await login('agency_admin', 'agency', null);
    const res = await request(env, '/api/agency/users/au_missing/reset-password', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('403s a viewer resetting a tenant user (tenantWrite required)', async () => {
    const { cookie, csrf } = await login('viewer', 'tenant', 't_beclinical');
    const res = await request(
      env,
      '/api/tenant/users/u_1/reset-password',
      {
        method: 'POST',
        headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        body: '{}',
      },
      'beclinical.bi.letlois.com'
    );
    expect(res.status).toBe(403);
  });

  it('rejects a reset without a CSRF token', async () => {
    const { cookie } = await login('agency_admin', 'agency', null);
    const res = await request(env, '/api/agency/users/au_1/reset-password', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});

// A tenant's timezone was free text, so "California" reached the database
// and every date formatter in the dashboard threw a RangeError on it,
// taking the whole client page down. Both write paths now reject a zone
// Intl cannot resolve.
describe('timezone validation', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    clearResolverCache();
    env = makeEnv();
    wireControlDb(env.CONTROL_DB as FakeD1);
  });

  async function agencyLogin() {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'agency',
      userId: 'u_test',
      role: 'agency_admin',
      tenantId: null,
      assignedTenants: null,
    });
    return { cookie: `lbi_session=${token}`, csrf };
  }

  async function tenantLogin() {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_test',
      role: 'account_admin',
      tenantId: 't_beclinical',
      assignedTenants: null,
    });
    return { cookie: `lbi_session=${token}`, csrf };
  }

  it('rejects provisioning a tenant with an unresolvable timezone', async () => {
    const { cookie, csrf } = await agencyLogin();
    const res = await request(env, '/api/agency/tenants', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'newclient',
        name: 'New Client',
        adminEmail: 'a@b.com',
        adminName: 'A',
        timezone: 'California',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unresolvable timezone on the settings route', async () => {
    const { cookie, csrf } = await tenantLogin();
    const res = await request(
      env,
      '/api/tenant/settings/timezone',
      {
        method: 'PUT',
        headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        body: JSON.stringify({ timezone: 'California' }),
      },
      'beclinical.bi.letlois.com'
    );
    expect(res.status).toBe(400);
  });

  it('accepts a real IANA zone and stores it', async () => {
    const writes: unknown[][] = [];
    (env.CONTROL_DB as FakeD1).on(/UPDATE tenants SET timezone/, (params) => {
      writes.push(params);
      return {};
    });
    const { cookie, csrf } = await tenantLogin();
    const res = await request(
      env,
      '/api/tenant/settings/timezone',
      {
        method: 'PUT',
        headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        body: JSON.stringify({ timezone: 'America/Los_Angeles' }),
      },
      'beclinical.bi.letlois.com'
    );
    expect(res.status).toBe(200);
    expect(writes).toEqual([['America/Los_Angeles', 't_beclinical']]);
  });
});
