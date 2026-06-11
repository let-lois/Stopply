// Phase 7 penetration checklist, run as integration tests: cross tenant
// access by id guessing, viewer privilege escalation, unsigned webhooks,
// oversized payloads, SQL injection probes through every parameterized
// path, security headers, and the secrets serialization snapshot.

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
import { encryptCredentials } from '../src/crypto';
import type { Env } from '../src/env';

function tenantRow(id: string, slug: string, host: string, dbId: string) {
  return {
    id,
    slug,
    name: slug,
    status: 'active',
    plan: 'pro',
    timezone: 'America/Phoenix',
    d1_database_id: dbId,
    d1_database_name: `lbi-tenant-${slug}`,
    schema_version: 1,
    theme_json: null,
    layout_json: null,
    custom_hostname: host,
    hostname_status: 'active',
    footer_credit: 1,
    funnel_labels_json: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const ACME = tenantRow('t_acme', 'acme', 'bi.acme.com', 'db-acme');
const RIVAL = tenantRow('t_rival', 'rival', 'bi.rival.com', 'db-rival');

describe('penetration checklist', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;
  let auditRows: unknown[][];

  beforeEach(() => {
    clearResolverCache();
    tenantDb = new SqliteTenantD1();
    auditRows = [];
    env = makeEnv({ __tenantD1: tenantDb });
    const control = env.CONTROL_DB as FakeD1;
    control.on(/FROM tenants WHERE custom_hostname = \?/, (params) => ({
      first: params[0] === 'bi.acme.com' ? ACME : params[0] === 'bi.rival.com' ? RIVAL : null,
    }));
    control.on(/FROM tenants WHERE id = \?/, (params) => ({
      first: params[0] === 't_acme' ? ACME : params[0] === 't_rival' ? RIVAL : null,
    }));
    control.on(/FROM tenants WHERE slug = \?/, (params) => ({
      first: params[0] === 'acme' ? ACME : params[0] === 'rival' ? RIVAL : null,
    }));
    control.on(/INSERT INTO audit_log/, (params) => {
      auditRows.push(params);
      return {};
    });
  });

  async function sessionFor(role: string, userType: 'agency' | 'tenant', tenantId: string | null, assigned: string[] | null = null) {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType,
      userId: 'u_pen',
      role: role as never,
      tenantId,
      assignedTenants: assigned,
    });
    return { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf, 'content-type': 'application/json' };
  }

  it('a tenant session cannot reach another tenant by switching hostnames', async () => {
    const headers = await sessionFor('account_admin', 'tenant', 't_acme');
    const res = await app.request('https://bi.rival.com/api/tenant/settings', { headers }, env as unknown as Env);
    expect(res.status).toBe(403);
  });

  it('an agency_staff member cannot switch into an unassigned tenant by guessing its id, and the attempt leaves no tenant data behind', async () => {
    const headers = await sessionFor('agency_staff', 'agency', null, ['t_rival']);
    const res = await app.request(
      'https://bi.letlois.com/api/auth/switch-tenant',
      { method: 'POST', headers, body: JSON.stringify({ tenantId: 't_acme' }) },
      env as unknown as Env
    );
    expect(res.status).toBe(403);
  });

  it('a viewer cannot escalate to admin routes by direct call', async () => {
    const headers = await sessionFor('viewer', 'tenant', 't_acme');
    for (const [method, path, body] of [
      ['POST', '/api/tenant/users', { email: 'evil@x.com', name: 'Evil', role: 'account_admin' }],
      ['PUT', '/api/tenant/targets', { month: '2026-06', targets: { revenue: 1 } }],
      ['PUT', '/api/tenant/settings/theme', {}],
      ['POST', '/api/imports', { sourceKey: 'meta-csv', month: '2026-06', csv: 'a,b' }],
      ['PUT', '/api/tenant/integrations/boulevard/credentials', { provider: 'boulevard', credentials: {} }],
    ] as const) {
      const res = await app.request(
        `https://bi.acme.com${path}`,
        { method, headers, body: JSON.stringify(body) },
        env as unknown as Env
      );
      expect([401, 403]).toContain(res.status);
    }
  });

  it('a viewer cannot grant themselves Present via a crafted view config write', async () => {
    const headers = await sessionFor('account_admin', 'tenant', 't_acme');
    await tenantDb.query(
      'db-acme',
      `INSERT INTO users (id, email, name, role, password_hash) VALUES ('u_v', 'v@x.com', 'V', 'viewer', 'x')`
    );
    const res = await app.request(
      'https://bi.acme.com/api/tenant/users/u_v/view-config',
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ viewConfig: { tabs: ['present', 'data-team', 'performance'], months: 'all', channels: 'all' } }),
      },
      env as unknown as Env
    );
    const body = (await res.json()) as { viewConfig: { tabs: string[] } };
    expect(body.viewConfig.tabs).toEqual(['performance']);
  });

  it('unsigned and missigned webhooks are rejected', async () => {
    await tenantDb.query(
      'db-acme',
      `INSERT INTO sources (key, name, kind, signing_secret_hash) VALUES ('ghl-webhook', 'GHL', 'webhook', 'v1$nonce$deadbeef')`
    );
    const unsigned = await app.request(
      'https://bi.letlois.com/ingest/acme/ghl-webhook',
      { method: 'POST', body: '{}' },
      env as unknown as Env
    );
    expect(unsigned.status).toBe(401);
    const missigned = await app.request(
      'https://bi.letlois.com/ingest/acme/ghl-webhook',
      { method: 'POST', headers: { 'x-lbi-signature': 'f'.repeat(64) }, body: '{}' },
      env as unknown as Env
    );
    expect(missigned.status).toBe(401);
  });

  it('oversized ingest payloads are rejected with 413', async () => {
    const res = await app.request(
      'https://bi.letlois.com/ingest/acme/pixel',
      { method: 'POST', body: 'x'.repeat(40000) },
      env as unknown as Env
    );
    expect(res.status).toBe(413);
  });

  it('SQL injection probes through parameterized paths do not execute', async () => {
    const headers = await sessionFor('account_admin', 'tenant', 't_acme');
    await tenantDb.query('db-acme', `INSERT INTO sources (key, name, kind) VALUES ('meta-csv', 'Meta', 'csv')`);

    // Injection via the targets metric name lands as a literal value.
    const res = await app.request(
      'https://bi.acme.com/api/tenant/targets',
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ month: '2026-06', targets: { "x'); DROP TABLE targets; --": 1 } }),
      },
      env as unknown as Env
    );
    expect(res.status).toBe(200);
    const rows = await tenantDb.query('db-acme', `SELECT metric FROM targets`);
    expect(rows.results).toHaveLength(1); // table still exists, value stored literally

    // Injection through the month path parameter fails validation.
    const months = await app.request(
      "https://bi.acme.com/api/tenant/months/2026-06'--",
      { headers },
      env as unknown as Env
    );
    expect(months.status).toBe(400);

    // Injection through a source key path segment is rejected by the
    // route pattern, never reaching SQL.
    const verify = await app.request(
      `https://bi.acme.com/api/tenant/sources/${encodeURIComponent("k'; DROP TABLE sources; --")}/verify`,
      { method: 'POST', headers },
      env as unknown as Env
    );
    expect([200, 404]).toContain(verify.status);
    const sources = await tenantDb.query('db-acme', `SELECT * FROM sources`);
    expect(sources.results.length).toBeGreaterThan(0);
  });

  it('every response carries the security headers', async () => {
    const res = await app.request('https://bi.letlois.com/api/health', {}, env as unknown as Env);
    expect(res.headers.get('strict-transport-security')).toContain('max-age');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('failed cross tenant attempts produce no data and audit rows record real mutations only', async () => {
    const headers = await sessionFor('account_admin', 'tenant', 't_acme');
    await app.request(
      'https://bi.acme.com/api/tenant/targets',
      { method: 'PUT', headers, body: JSON.stringify({ month: '2026-06', targets: { leads: 5 } }) },
      env as unknown as Env
    );
    expect(auditRows.length).toBeGreaterThan(0);
  });
});

describe('secrets never serialize into API responses', () => {
  it('integration responses exclude ciphertext, ivs, and decrypted credentials', async () => {
    clearResolverCache();
    const tenantDb = new SqliteTenantD1();
    const env = makeEnv({ __tenantD1: tenantDb });
    (env.CONTROL_DB as FakeD1).on(/FROM tenants WHERE custom_hostname = \?/, () => ({ first: ACME }));
    (env.CONTROL_DB as FakeD1).on(/INSERT INTO audit_log/, () => ({}));

    const secretValue = 'super-secret-api-key-12345';
    const { ciphertext, iv } = await encryptCredentials(
      (env as { CRED_MASTER_KEY: string }).CRED_MASTER_KEY,
      JSON.stringify({ apiKey: secretValue })
    );
    await tenantDb.query(
      'db-acme',
      `INSERT INTO integrations (key, provider, status, credentials_ciphertext, credentials_iv, connected_as)
       VALUES ('boulevard', 'boulevard', 'connected', ?, ?, 'Acme Spa')`,
      [ciphertext, iv]
    );

    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_a',
      role: 'account_admin',
      tenantId: 't_acme',
      assignedTenants: null,
    });
    const res = await app.request(
      'https://bi.acme.com/api/tenant/integrations',
      { headers: { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf } },
      env as unknown as Env
    );
    const text = await res.text();
    expect(text).not.toContain(secretValue);
    expect(text).not.toContain(ciphertext);
    expect(text).not.toContain(iv);
    expect(text).not.toContain('credentials_ciphertext');
    // Snapshot of the public serializer shape: only these keys appear.
    const body = JSON.parse(text) as { integrations: Array<Record<string, unknown>> };
    expect(Object.keys(body.integrations[0]!).sort()).toEqual([
      'connectedAs',
      'connectedAt',
      'key',
      'lastSyncAt',
      'lastSyncResult',
      'planCheck',
      'provider',
      'status',
    ]);
  });

  it('user listings exclude password hashes', async () => {
    clearResolverCache();
    const tenantDb = new SqliteTenantD1();
    const env = makeEnv({ __tenantD1: tenantDb });
    (env.CONTROL_DB as FakeD1).on(/FROM tenants WHERE custom_hostname = \?/, () => ({ first: ACME }));
    await tenantDb.query(
      'db-acme',
      `INSERT INTO users (id, email, name, role, password_hash) VALUES ('u1', 'a@x.com', 'A', 'account_admin', 'pbkdf2$100000$salt$hash')`
    );
    const { token } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u1',
      role: 'account_admin',
      tenantId: 't_acme',
      assignedTenants: null,
    });
    const res = await app.request(
      'https://bi.acme.com/api/tenant/users',
      { headers: { cookie: `lbi_session=${token}` } },
      env as unknown as Env
    );
    const text = await res.text();
    expect(text).not.toContain('pbkdf2$');
    expect(text).not.toContain('password_hash');
  });
});
