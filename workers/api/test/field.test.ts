// The field app's API end to end: a rep signs in on their tenant's host,
// logs knocks from a phone that keeps losing signal, and reads back their
// own work. Runs against real SQLite through the tenant migrations, so the
// idempotency and address collapsing behaviour is genuine rather than
// mocked.

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
import { hashPassword } from '../src/crypto';
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

describe('field app API', () => {
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
      .on(/FROM tenants WHERE id = \?/, (params) => ({
        first: params[0] === 't_allstar' ? TENANT_ROW : null,
      }))
      .on(/INSERT INTO audit_log/, () => ({}));

    await tenantDb.query(
      'db-allstar',
      `INSERT INTO field_reps (id, email, name, role, password_hash, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      ['fr_dana', 'dana@allstar.test', 'Dana Reyes', 'rep', await hashPassword('knock-knock')]
    );
    await tenantDb.query(
      'db-allstar',
      `INSERT INTO field_reps (id, email, name, role, password_hash, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      ['fr_boss', 'boss@allstar.test', 'Sam Cole', 'manager', await hashPassword('team-lead-1')]
    );
  });

  async function signIn(email = 'dana@allstar.test', password = 'knock-knock') {
    const res = await app.request(
      `${HOST}/api/field/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      },
      env as unknown as Env
    );
    const body = (await res.json()) as { csrf?: string };
    const setCookie = res.headers.get('set-cookie') ?? '';
    const token = /lbi_field=([^;]*)/.exec(setCookie)?.[1] ?? '';
    return {
      status: res.status,
      headers: {
        cookie: `lbi_field=${token}`,
        'x-csrf-token': body.csrf ?? '',
        'content-type': 'application/json',
      },
    };
  }

  function visitBody(over: Record<string, unknown> = {}) {
    return {
      clientUuid: 'uuid-0000-0001',
      street: '123 N. Main Street',
      city: 'Mesa',
      state: 'AZ',
      postalCode: '85201',
      disposition: 'no_answer',
      occurredAt: new Date().toISOString(),
      ...over,
    };
  }

  async function postVisit(headers: Record<string, string>, over: Record<string, unknown> = {}) {
    return app.request(
      `${HOST}/api/field/visits`,
      { method: 'POST', headers, body: JSON.stringify(visitBody(over)) },
      env as unknown as Env
    );
  }

  describe('sign in', () => {
    it('issues a field cookie, not a dashboard one', async () => {
      const res = await app.request(
        `${HOST}/api/field/login`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'dana@allstar.test', password: 'knock-knock' }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const cookie = res.headers.get('set-cookie') ?? '';
      expect(cookie).toContain('lbi_field=');
      expect(cookie).not.toContain('lbi_session=');
      expect(cookie).toContain('HttpOnly');
    });

    it('refuses a wrong password and an unknown email alike', async () => {
      expect((await signIn('dana@allstar.test', 'wrong')).status).toBe(401);
      expect((await signIn('nobody@allstar.test', 'knock-knock')).status).toBe(401);
    });

    it('refuses a deactivated rep', async () => {
      await tenantDb.query('db-allstar', `UPDATE field_reps SET active = 0 WHERE id = 'fr_dana'`);
      expect((await signIn()).status).toBe(401);
    });

    it('is not reachable on the agency host', async () => {
      const res = await app.request(
        'https://bi.letlois.com/api/field/login',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'dana@allstar.test', password: 'knock-knock' }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });
  });

  describe('bootstrap', () => {
    it('returns the rep, the client name, and the outcome buttons in one call', async () => {
      const { headers } = await signIn();
      const res = await app.request(`${HOST}/api/field/me`, { headers }, env as unknown as Env);
      const body = (await res.json()) as {
        rep: { name: string; role: string };
        tenant: { name: string; timezone: string };
        dispositions: Array<{ key: string }>;
      };
      expect(body.rep).toMatchObject({ name: 'Dana Reyes', role: 'rep' });
      expect(body.tenant).toMatchObject({ name: 'All Star', timezone: 'America/Phoenix' });
      expect(body.dispositions.map((d) => d.key)).toContain('appointment');
    });

    it('locks out a rep deactivated while their session was still alive', async () => {
      const { headers } = await signIn();
      await tenantDb.query('db-allstar', `UPDATE field_reps SET active = 0 WHERE id = 'fr_dana'`);
      const res = await app.request(`${HOST}/api/field/me`, { headers }, env as unknown as Env);
      expect(res.status).toBe(401);
    });
  });

  describe('logging a visit', () => {
    it('records a knock and creates the door behind it', async () => {
      const { headers } = await signIn();
      const res = await postVisit(headers, { disposition: 'appointment', notes: 'Back Tuesday 6pm' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; duplicate: boolean };
      expect(body.duplicate).toBe(false);

      const rows = await tenantDb.query(
        'db-allstar',
        `SELECT visit_count, last_disposition FROM field_addresses`
      );
      expect(rows.results[0]).toMatchObject({ visit_count: 1, last_disposition: 'appointment' });
    });

    it('is safe to retry forever: the same client_uuid never double counts', async () => {
      // This is the offline path. The phone resends until it hears back, so
      // the same knock can arrive many times over.
      const { headers } = await signIn();
      const first = await postVisit(headers);
      const second = await postVisit(headers);
      const third = await postVisit(headers);

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(((await second.json()) as { duplicate: boolean }).duplicate).toBe(true);
      expect(((await third.json()) as { duplicate: boolean }).duplicate).toBe(true);

      const visits = await tenantDb.query<{ n: number }>(
        'db-allstar',
        `SELECT COUNT(*) AS n FROM field_visits`
      );
      expect(visits.results[0]?.n).toBe(1);
      const addr = await tenantDb.query<{ visit_count: number }>(
        'db-allstar',
        `SELECT visit_count FROM field_addresses`
      );
      expect(addr.results[0]?.visit_count).toBe(1);
    });

    it('collapses the ways two reps type the same house onto one door', async () => {
      const dana = await signIn();
      const boss = await signIn('boss@allstar.test', 'team-lead-1');
      await postVisit(dana.headers, { clientUuid: 'uuid-aaaa-0001', street: '123 N. Main Street' });
      await postVisit(boss.headers, { clientUuid: 'uuid-bbbb-0002', street: '123 n main st' });

      const addrs = await tenantDb.query<{ n: number }>(
        'db-allstar',
        `SELECT COUNT(*) AS n FROM field_addresses`
      );
      expect(addrs.results[0]?.n).toBe(1);
      const addr = await tenantDb.query<{ visit_count: number }>(
        'db-allstar',
        `SELECT visit_count FROM field_addresses`
      );
      expect(addr.results[0]?.visit_count).toBe(2);
    });

    it('marks the door do-not-knock for the whole team', async () => {
      const { headers } = await signIn();
      await postVisit(headers, { disposition: 'do_not_knock' });
      const addr = await tenantDb.query<{ do_not_knock: number }>(
        'db-allstar',
        `SELECT do_not_knock FROM field_addresses`
      );
      expect(addr.results[0]?.do_not_knock).toBe(1);
    });

    it('does not let a late upload roll back the door state', async () => {
      // A phone that regained signal uploads Monday's knock after
      // Wednesday's. The door's current outcome must stay Wednesday's.
      const { headers } = await signIn();
      const wednesday = new Date(Date.now() - 86400000).toISOString();
      const monday = new Date(Date.now() - 3 * 86400000).toISOString();
      await postVisit(headers, { clientUuid: 'uuid-wed', disposition: 'do_not_knock', occurredAt: wednesday });
      await postVisit(headers, { clientUuid: 'uuid-mon', disposition: 'no_answer', occurredAt: monday });

      const addr = await tenantDb.query<{
        last_disposition: string;
        do_not_knock: number;
        visit_count: number;
        first_visited_at: string;
      }>('db-allstar', `SELECT last_disposition, do_not_knock, visit_count, first_visited_at FROM field_addresses`);
      expect(addr.results[0]?.last_disposition).toBe('do_not_knock');
      expect(addr.results[0]?.do_not_knock).toBe(1);
      expect(addr.results[0]?.visit_count).toBe(2);
      expect(addr.results[0]?.first_visited_at).toBe(monday);
    });

    it('refuses an outcome that is not in the catalog', async () => {
      const { headers } = await signIn();
      const res = await postVisit(headers, { disposition: 'made_it_up' });
      expect(res.status).toBe(400);
    });

    it('refuses a deactivated outcome', async () => {
      await tenantDb.query(
        'db-allstar',
        `UPDATE field_dispositions SET active = 0 WHERE key = 'renter'`
      );
      const { headers } = await signIn();
      expect((await postVisit(headers, { disposition: 'renter' })).status).toBe(400);
    });

    it('refuses a timestamp from a phone with a badly wrong clock', async () => {
      const { headers } = await signIn();
      const longAgo = new Date(Date.now() - 90 * 86400000).toISOString();
      const future = new Date(Date.now() + 5 * 86400000).toISOString();
      expect((await postVisit(headers, { clientUuid: 'uuid-cccc-0001', occurredAt: longAgo })).status).toBe(400);
      expect((await postVisit(headers, { clientUuid: 'uuid-cccc-0002', occurredAt: future })).status).toBe(400);
    });

    it('accepts a knock logged hours ago while the phone had no signal', async () => {
      const { headers } = await signIn();
      const earlier = new Date(Date.now() - 6 * 3600000).toISOString();
      const res = await postVisit(headers, { occurredAt: earlier });
      expect(res.status).toBe(201);
      const row = await tenantDb.query<{ occurred_at: string }>(
        'db-allstar',
        `SELECT occurred_at FROM field_visits`
      );
      // Stored as the rep's clock at the door, not arrival time, so the
      // knock stays on the day it happened.
      expect(row.results[0]?.occurred_at).toBe(earlier);
    });

    it('requires the CSRF header on a write', async () => {
      const { headers } = await signIn();
      const res = await app.request(
        `${HOST}/api/field/visits`,
        {
          method: 'POST',
          headers: { cookie: headers.cookie, 'content-type': 'application/json' },
          body: JSON.stringify(visitBody()),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(403);
    });

    it('refuses an unauthenticated write', async () => {
      const res = await app.request(
        `${HOST}/api/field/visits`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(visitBody()),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(401);
    });
  });

  describe('reading back my own work', () => {
    it("returns only this rep's visits", async () => {
      const dana = await signIn();
      const boss = await signIn('boss@allstar.test', 'team-lead-1');
      await postVisit(dana.headers, { clientUuid: 'uuid-dana', street: '1 A St' });
      await postVisit(boss.headers, { clientUuid: 'uuid-boss', street: '2 B St' });

      const res = await app.request(
        `${HOST}/api/field/visits`,
        { headers: dana.headers },
        env as unknown as Env
      );
      const body = (await res.json()) as { visits: Array<{ address: string }> };
      expect(body.visits).toHaveLength(1);
      expect(body.visits[0]?.address).toContain('1 A St');
    });

    it('lets a rep fix a note on a fresh visit', async () => {
      const { headers } = await signIn();
      const created = (await (await postVisit(headers)).json()) as { id: string };
      const res = await app.request(
        `${HOST}/api/field/visits/${created.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ notes: 'Dog in the yard' }) },
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const row = await tenantDb.query<{ notes: string; edited_at: string | null }>(
        'db-allstar',
        `SELECT notes, edited_at FROM field_visits`
      );
      expect(row.results[0]?.notes).toBe('Dog in the yard');
      expect(row.results[0]?.edited_at).not.toBeNull();
    });

    it("does not let a rep edit somebody else's visit, or learn that it exists", async () => {
      const dana = await signIn();
      const boss = await signIn('boss@allstar.test', 'team-lead-1');
      const theirs = (await (await postVisit(boss.headers, { clientUuid: 'uuid-boss' })).json()) as {
        id: string;
      };
      const res = await app.request(
        `${HOST}/api/field/visits/${theirs.id}`,
        { method: 'PATCH', headers: dana.headers, body: JSON.stringify({ notes: 'nope' }) },
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });

    it("closes the edit window on yesterday's work", async () => {
      const { headers } = await signIn();
      const old = new Date(Date.now() - 2 * 86400000).toISOString();
      const created = (await (await postVisit(headers, { occurredAt: old })).json()) as { id: string };
      const res = await app.request(
        `${HOST}/api/field/visits/${created.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ notes: 'too late' }) },
        env as unknown as Env
      );
      expect(res.status).toBe(403);
    });
  });

  describe('what the team knows about this door', () => {
    it('surfaces a nearby do-not-knock house before the rep walks up', async () => {
      const { headers } = await signIn();
      await postVisit(headers, {
        disposition: 'do_not_knock',
        lat: 33.4152,
        lng: -111.8315,
      });
      const res = await app.request(
        `${HOST}/api/field/addresses/nearby?lat=33.4153&lng=-111.8316`,
        { headers },
        env as unknown as Env
      );
      const body = (await res.json()) as { addresses: Array<{ doNotKnock: boolean }> };
      expect(body.addresses).toHaveLength(1);
      expect(body.addresses[0]?.doNotKnock).toBe(true);
    });

    it('leaves out doors on the other side of town', async () => {
      const { headers } = await signIn();
      await postVisit(headers, { lat: 33.4152, lng: -111.8315 });
      const res = await app.request(
        `${HOST}/api/field/addresses/nearby?lat=34.9&lng=-112.9`,
        { headers },
        env as unknown as Env
      );
      expect(((await res.json()) as { addresses: unknown[] }).addresses).toHaveLength(0);
    });
  });

  describe('my numbers', () => {
    it('scores the rep on today and the trailing week', async () => {
      const { headers } = await signIn();
      await postVisit(headers, { clientUuid: 'uuid-cccc-0001', street: '1 A St', disposition: 'no_answer' });
      await postVisit(headers, { clientUuid: 'uuid-cccc-0002', street: '2 A St', disposition: 'sale' });
      const res = await app.request(`${HOST}/api/field/stats`, { headers }, env as unknown as Env);
      const body = (await res.json()) as {
        today: { visits: number; sales: number };
        team?: unknown;
      };
      expect(body.today).toMatchObject({ visits: 2, sales: 1 });
      // A rep sees their own numbers only.
      expect(body.team).toBeUndefined();
    });

    it('gives a manager the team total as well', async () => {
      const dana = await signIn();
      const boss = await signIn('boss@allstar.test', 'team-lead-1');
      await postVisit(dana.headers, { clientUuid: 'uuid-cccc-0001', street: '1 A St' });
      await postVisit(boss.headers, { clientUuid: 'uuid-cccc-0002', street: '2 A St' });
      const res = await app.request(
        `${HOST}/api/field/stats`,
        { headers: boss.headers },
        env as unknown as Env
      );
      const body = (await res.json()) as {
        week: { visits: number };
        team: { visits: number };
      };
      expect(body.week.visits).toBe(1);
      expect(body.team.visits).toBe(2);
    });
  });

  describe('isolation from the dashboard', () => {
    it('refuses a rep session presented as a dashboard cookie', async () => {
      // The field token is HttpOnly, but a stolen one must still be useless
      // against the dashboard rather than relying on that.
      const { token } = await createSession(env as unknown as Env, {
        userType: 'field',
        userId: 'fr_dana',
        role: 'rep',
        tenantId: 't_allstar',
        assignedTenants: null,
      });
      const res = await app.request(
        `${HOST}/api/tenant/settings`,
        { headers: { cookie: `lbi_session=${token}` } },
        env as unknown as Env
      );
      expect(res.status).toBe(401);
    });

    it('refuses a rep session against the field reporting routes', async () => {
      const { headers } = await signIn();
      const res = await app.request(
        `${HOST}/api/tenant/field/overview`,
        { headers: { cookie: headers.cookie } },
        env as unknown as Env
      );
      expect(res.status).toBe(401);
    });

    it('refuses a rep whose session belongs to another tenant', async () => {
      const { token } = await createSession(env as unknown as Env, {
        userType: 'field',
        userId: 'fr_dana',
        role: 'rep',
        tenantId: 't_somebody_else',
        assignedTenants: null,
      });
      const res = await app.request(
        `${HOST}/api/field/me`,
        { headers: { cookie: `lbi_field=${token}` } },
        env as unknown as Env
      );
      expect(res.status).toBe(403);
    });

    it('leaves a dashboard session working alongside a field session', async () => {
      // Both cookies on one hostname: an account admin who also carries a
      // rep login must not sign themselves out of one by using the other.
      const { headers } = await signIn();
      const dashboard = await createSession(env as unknown as Env, {
        userType: 'tenant',
        userId: 'u_admin',
        role: 'account_admin',
        tenantId: 't_allstar',
        assignedTenants: null,
      });
      const both = `lbi_field=${headers.cookie.split('=')[1]}; lbi_session=${dashboard.token}`;
      const fieldRes = await app.request(
        `${HOST}/api/field/me`,
        { headers: { cookie: both } },
        env as unknown as Env
      );
      const dashRes = await app.request(
        `${HOST}/api/tenant/settings`,
        { headers: { cookie: both } },
        env as unknown as Env
      );
      expect(fieldRes.status).toBe(200);
      expect(dashRes.status).toBe(200);
    });
  });
});
