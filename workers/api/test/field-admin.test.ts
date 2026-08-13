// The reporting and roster side of field tracking, as the client and the
// agency see it under /api/tenant/field.

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
import type { Env } from '../src/env';

const TENANT_ROW = {
  id: 't_allstar',
  slug: 'all-star',
  name: 'All Star',
  status: 'active',
  plan: 'pro',
  timezone: 'America/Phoenix',
  d1_database_id: 'db-allstar',
  d1_database_name: 'lbi-tenant-all-star',
  schema_version: 6,
  theme_json: null,
  layout_json: null,
  custom_hostname: null,
  hostname_status: null,
  footer_credit: 1,
  funnel_labels_json: null,
  created_at: '2026-01-01T00:00:00Z',
};

const HOST = 'https://all-star.bi.letlois.com';

// Phoenix is UTC-7 with no daylight saving, so 2026-08-11T18:00Z and
// 2026-08-12T02:00Z are both the 11th locally. The fixtures lean on that
// to prove reporting buckets by the client's own day.
const VISITS: Array<[string, string, string, string]> = [
  // id, rep, disposition, occurredAt
  ['v1', 'fr_dana', 'no_answer', '2026-08-11T18:00:00.000Z'],
  ['v2', 'fr_dana', 'not_interested', '2026-08-11T19:00:00.000Z'],
  ['v3', 'fr_dana', 'appointment', '2026-08-12T02:00:00.000Z'],
  ['v4', 'fr_boss', 'no_answer', '2026-08-12T18:00:00.000Z'],
  ['v5', 'fr_boss', 'sale', '2026-08-12T19:00:00.000Z'],
];

describe('field reporting', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;
  let adminHeaders: Record<string, string>;

  async function seed() {
    for (const [id, rep, name] of [
      ['fr_dana', 'dana@allstar.test', 'Dana Reyes'],
      ['fr_boss', 'boss@allstar.test', 'Sam Cole'],
    ]) {
      await tenantDb.query(
        'db-allstar',
        `INSERT INTO field_reps (id, email, name, role, password_hash, active) VALUES (?, ?, ?, 'rep', 'x', 1)`,
        [id, rep, name]
      );
    }
    await tenantDb.query(
      'db-allstar',
      `INSERT INTO field_addresses (id, address_key, street, city, state, postal_code, lat, lng)
       VALUES ('fa_1', '123 main st||85201', '123 Main St', 'Mesa', 'AZ', '85201', 33.4, -111.8)`
    );
    for (const [id, repId, disposition, occurredAt] of VISITS) {
      await tenantDb.query(
        'db-allstar',
        `INSERT INTO field_visits (id, client_uuid, address_id, rep_id, disposition, occurred_at)
         VALUES (?, ?, 'fa_1', ?, ?, ?)`,
        [id, `uuid-${id}`, repId, disposition, occurredAt]
      );
    }
  }

  async function sessionHeaders(role: 'account_admin' | 'viewer') {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: `u_${role}`,
      role,
      tenantId: 't_allstar',
      assignedTenants: null,
    });
    return {
      cookie: `lbi_session=${token}`,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    };
  }

  beforeEach(async () => {
    clearResolverCache();
    tenantDb = new SqliteTenantD1();
    env = makeEnv({ __tenantD1: tenantDb });
    (env.CONTROL_DB as FakeD1)
      .on(/FROM tenants WHERE slug = \?/, (params) => ({
        first: params[0] === 'all-star' ? TENANT_ROW : null,
      }))
      .on(/FROM tenants WHERE custom_hostname = \?/, () => ({ first: null }))
      .on(/INSERT INTO audit_log/, () => ({}));
    await seed();
    adminHeaders = await sessionHeaders('account_admin');
  });

  function overview(query = 'from=2026-08-10&to=2026-08-13') {
    return app.request(`${HOST}/api/tenant/field/overview?${query}`, { headers: adminHeaders }, env as unknown as Env);
  }

  it('reports the funnel across the window', async () => {
    const body = (await (await overview()).json()) as {
      totals: { visits: number; doors: number; contacts: number; appointments: number; sales: number };
    };
    expect(body.totals).toMatchObject({
      visits: 5,
      // Every fixture visit is the same house, so five knocks are one door.
      doors: 1,
      contacts: 3,
      appointments: 2,
      sales: 1,
    });
  });

  it('buckets the daily trend by the client timezone', async () => {
    const body = (await (await overview()).json()) as {
      timezone: string;
      daily: Array<{ day: string; visits: number }>;
    };
    expect(body.timezone).toBe('America/Phoenix');
    const byDay = Object.fromEntries(body.daily.map((d) => [d.day, d.visits]));
    // v3 lands at 02:00Z on the 12th, which is still the 11th in Phoenix.
    expect(byDay['2026-08-11']).toBe(3);
    expect(byDay['2026-08-12']).toBe(2);
    // A day nobody knocked is present and zero rather than missing.
    expect(byDay['2026-08-13']).toBe(0);
  });

  it('ranks the leaderboard by conversion, not distance walked', async () => {
    const body = (await (await overview()).json()) as {
      reps: Array<{ repName: string; sales: number; visits: number }>;
    };
    expect(body.reps[0]?.repName).toBe('Sam Cole');
    expect(body.reps[0]?.sales).toBe(1);
    expect(body.reps[1]?.repName).toBe('Dana Reyes');
    expect(body.reps[1]?.visits).toBe(3);
  });

  it('breaks outcomes down to the knock count', async () => {
    const body = (await (await overview()).json()) as {
      dispositions: Array<{ key: string; count: number }>;
    };
    expect(body.dispositions.reduce((n, d) => n + d.count, 0)).toBe(5);
    expect(body.dispositions.find((d) => d.key === 'no_answer')?.count).toBe(2);
  });

  it('excludes visits outside the requested window', async () => {
    const body = (await (await overview('from=2026-08-12&to=2026-08-12')).json()) as {
      totals: { visits: number };
    };
    // Phoenix 2026-08-12 holds v4 and v5 only.
    expect(body.totals.visits).toBe(2);
  });

  it('exports the visit log as CSV with the fields quoted safely', async () => {
    await tenantDb.query(
      'db-allstar',
      `UPDATE field_visits SET notes = 'Said "call me", then hung up' WHERE id = 'v5'`
    );
    const res = await app.request(
      `${HOST}/api/tenant/field/visits.csv?from=2026-08-10&to=2026-08-13`,
      { headers: adminHeaders },
      env as unknown as Env
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('field-visits-2026-08-10-to-2026-08-13.csv');
    const text = await res.text();
    expect(text.split('\n')).toHaveLength(6);
    expect(text).toContain('"Said ""call me"", then hung up"');
  });

  describe('roster', () => {
    it('creates a rep and returns the first password exactly once', async () => {
      const res = await app.request(
        `${HOST}/api/tenant/field/reps`,
        {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({ email: 'New@AllStar.test', name: 'Alex Rios', role: 'rep' }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { email: string; tempPassword: string };
      expect(body.email).toBe('new@allstar.test');
      expect(body.tempPassword.length).toBeGreaterThan(8);

      const list = (await (
        await app.request(`${HOST}/api/tenant/field/reps`, { headers: adminHeaders }, env as unknown as Env)
      ).json()) as { reps: Array<{ email: string; password_hash?: string }> };
      const created = list.reps.find((r) => r.email === 'new@allstar.test');
      expect(created).toBeDefined();
      // The roster never carries password hashes over the wire.
      expect(created?.password_hash).toBeUndefined();
    });

    it('refuses a duplicate rep email', async () => {
      const res = await app.request(
        `${HOST}/api/tenant/field/reps`,
        {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({ email: 'dana@allstar.test', name: 'Dana Again' }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(409);
    });

    it('lets an admin deactivate a rep', async () => {
      const res = await app.request(
        `${HOST}/api/tenant/field/reps/fr_dana`,
        { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ active: false }) },
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const row = await tenantDb.query<{ active: number }>(
        'db-allstar',
        `SELECT active FROM field_reps WHERE id = 'fr_dana'`
      );
      expect(row.results[0]?.active).toBe(0);
    });
  });

  describe('viewers', () => {
    it('can read the reporting', async () => {
      const headers = await sessionHeaders('viewer');
      const res = await app.request(
        `${HOST}/api/tenant/field/overview`,
        { headers },
        env as unknown as Env
      );
      expect(res.status).toBe(200);
    });

    it('cannot add a rep', async () => {
      const headers = await sessionHeaders('viewer');
      const res = await app.request(
        `${HOST}/api/tenant/field/reps`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ email: 'sneak@allstar.test', name: 'Sneak' }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(403);
    });
  });

  describe('outcome catalog', () => {
    it('keeps a renamed outcome attached to the funnel', async () => {
      const res = await app.request(
        `${HOST}/api/tenant/field/dispositions/appointment`,
        { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ label: 'Demo booked' }) },
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const body = (await (await overview()).json()) as {
        totals: { appointments: number };
        dispositions: Array<{ key: string; label: string }>;
      };
      // Renaming changes the label the client reads, not the stage it feeds.
      expect(body.totals.appointments).toBe(2);
      expect(body.dispositions.find((d) => d.key === 'appointment')?.label).toBe('Demo booked');
    });

    it('adds a client specific outcome', async () => {
      const res = await app.request(
        `${HOST}/api/tenant/field/dispositions/storm_damage`,
        {
          method: 'PUT',
          headers: adminHeaders,
          body: JSON.stringify({ label: 'Storm damage found', isContact: true, isLead: true }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const list = (await (
        await app.request(
          `${HOST}/api/tenant/field/dispositions`,
          { headers: adminHeaders },
          env as unknown as Env
        )
      ).json()) as { dispositions: Array<{ key: string; isLead: boolean }> };
      expect(list.dispositions.find((d) => d.key === 'storm_damage')?.isLead).toBe(true);
    });

    it('rejects an outcome key that is not a safe identifier', async () => {
      const res = await app.request(
        `${HOST}/api/tenant/field/dispositions/DROP%20TABLE`,
        { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ label: 'nope' }) },
        env as unknown as Env
      );
      expect(res.status).toBe(400);
    });
  });
});

describe('field app address', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;

  beforeEach(async () => {
    clearResolverCache();
    tenantDb = new SqliteTenantD1();
    env = makeEnv({ __tenantD1: tenantDb });
    (env.CONTROL_DB as FakeD1)
      .on(/FROM tenants WHERE slug = \?/, (params) => ({
        first: params[0] === 'all-star' ? TENANT_ROW : null,
      }))
      .on(/FROM tenants WHERE custom_hostname = \?/, () => ({ first: null }))
      .on(/INSERT INTO audit_log/, () => ({}));
  });

  async function reps(headers: Record<string, string>) {
    const res = await app.request(`${HOST}/api/tenant/field/reps`, { headers }, env as unknown as Env);
    return (await res.json()) as { reps: unknown[]; fieldAppUrl: string };
  }

  it('points reps at the tenant subdomain, never the agency host', async () => {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_admin',
      role: 'account_admin',
      tenantId: 't_allstar',
      assignedTenants: null,
    });
    const body = await reps({ cookie: `lbi_session=${token}`, 'x-csrf-token': csrf });
    // A field session is only valid on the tenant's own host, so this is the
    // only address that can work however the admin reached the dashboard.
    expect(body.fieldAppUrl).toBe('https://all-star.bi.letlois.com/field');
    expect(body.reps).toHaveLength(0);
  });

  it('prefers a client custom domain when one is set up', async () => {
    // A fresh control plane: FakeD1 answers with the first handler whose
    // pattern matches, so re-registering on the existing one would never win.
    clearResolverCache();
    const branded = { ...TENANT_ROW, custom_hostname: 'dash.allstar.com' };
    env = makeEnv({ __tenantD1: tenantDb });
    (env.CONTROL_DB as FakeD1)
      .on(/FROM tenants WHERE slug = \?/, () => ({ first: branded }))
      .on(/FROM tenants WHERE custom_hostname = \?/, () => ({ first: null }));
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_admin',
      role: 'account_admin',
      tenantId: 't_allstar',
      assignedTenants: null,
    });
    const body = await reps({ cookie: `lbi_session=${token}`, 'x-csrf-token': csrf });
    expect(body.fieldAppUrl).toBe('https://dash.allstar.com/field');
  });
});
