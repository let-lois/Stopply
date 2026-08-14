// The standalone field app's way in.
//
// The store builds run from their own WebView origin, so they cannot hold
// the field cookie and cannot be same origin with this API. These tests pin
// the three things that makes necessary: a token handed back at login, a
// bearer header accepted in place of the cookie, and CORS opened for the
// field API and nothing else. They also pin what must not follow from any
// of that.

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession, getSession } from '../src/session';
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
  schema_version: 7,
  theme_json: null,
  layout_json: null,
  custom_hostname: null,
  hostname_status: null,
  footer_credit: 1,
  funnel_labels_json: null,
  created_at: '2026-01-01T00:00:00Z',
};

const HOST = 'https://all-star.bi.letlois.com';
// What an iOS Capacitor WebView actually sends.
const APP_ORIGIN = 'capacitor://localhost';

describe('the standalone field app', () => {
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
  });

  function request(path: string, init: RequestInit = {}) {
    return app.request(`${HOST}${path}`, init, env as unknown as Env);
  }

  // Sign in the way the app does, and keep the token it is handed.
  async function signInFromApp() {
    const res = await request('/api/field/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
      body: JSON.stringify({ email: 'dana@allstar.test', password: 'knock-knock' }),
    });
    const body = (await res.json()) as { token?: string; csrf?: string };
    return { res, token: body.token ?? '', csrf: body.csrf ?? '' };
  }

  function appHeaders(token: string, extra: Record<string, string> = {}) {
    return {
      authorization: `Bearer ${token}`,
      origin: APP_ORIGIN,
      'content-type': 'application/json',
      ...extra,
    };
  }

  describe('signing in', () => {
    it('hands the app a session token it can hold itself', async () => {
      const { res, token } = await signInFromApp();
      expect(res.status).toBe(200);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      // The token is a real session, not a second credential to track.
      expect((await getSession(env as unknown as Env, token))?.userType).toBe('field');
    });

    it('still sets the cookie, so the web field app is unaffected', async () => {
      const { res } = await signInFromApp();
      expect(res.headers.get('set-cookie') ?? '').toContain('lbi_field=');
    });

    // A browser on the dashboard host keeps its HttpOnly cookie. Handing the
    // token to script there would turn a credential script cannot read into
    // one it can.
    it('withholds the token from a browser on the dashboard origin', async () => {
      const res = await request('/api/field/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: HOST },
        body: JSON.stringify({ email: 'dana@allstar.test', password: 'knock-knock' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).not.toHaveProperty('token');
    });
  });

  describe('working with a bearer token', () => {
    it('bootstraps the app', async () => {
      const { token } = await signInFromApp();
      const res = await request('/api/field/me', { headers: appHeaders(token) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rep: { name: string }; tenant: { name: string } };
      expect(body.rep.name).toBe('Dana Reyes');
      expect(body.tenant.name).toBe('All Star');
    });

    // The whole point: a knock logged from the app reaches the same place a
    // knock from the web app does.
    it('logs a knock without a cookie or a csrf header', async () => {
      const { token } = await signInFromApp();
      const res = await request('/api/field/visits', {
        method: 'POST',
        headers: appHeaders(token),
        body: JSON.stringify({
          clientUuid: 'uuid-native-0001',
          street: '123 N. Main Street',
          city: 'Mesa',
          state: 'AZ',
          postalCode: '85201',
          disposition: 'no_answer',
          occurredAt: new Date().toISOString(),
        }),
      });
      expect(res.status).toBe(201);
    });

    it('refuses a made up token', async () => {
      const res = await request('/api/field/me', {
        headers: appHeaders('0'.repeat(64)),
      });
      expect(res.status).toBe(401);
    });

    it('stops working once the rep signs out', async () => {
      const { token } = await signInFromApp();
      const out = await request('/api/field/logout', {
        method: 'POST',
        headers: appHeaders(token),
        body: '{}',
      });
      expect(out.status).toBe(200);
      const after = await request('/api/field/me', { headers: appHeaders(token) });
      expect(after.status).toBe(401);
    });

    it('stops working once the rep is deactivated', async () => {
      const { token } = await signInFromApp();
      await tenantDb.query('db-allstar', `UPDATE field_reps SET active = 0 WHERE id = 'fr_dana'`);
      const res = await request('/api/field/me', { headers: appHeaders(token) });
      expect(res.status).toBe(401);
    });
  });

  // A bearer token is a field rep's token and nothing else. None of this may
  // become a second way into client reporting or the agency console.
  describe('what a bearer token still cannot do', () => {
    it('cannot read client reporting', async () => {
      const { token } = await signInFromApp();
      const res = await request('/api/tenant/field/overview', { headers: appHeaders(token) });
      expect(res.status).toBe(401);
    });

    it('cannot stand in for a dashboard session', async () => {
      const { token } = await createSession(env as unknown as Env, {
        userType: 'tenant',
        userId: 'u_admin',
        role: 'account_admin',
        tenantId: 't_allstar',
        assignedTenants: null,
      });
      // A real dashboard session, presented the way the field app presents
      // its own. The dashboard is cookie only, so this buys nothing.
      const res = await request('/api/tenant/summary', {
        headers: { authorization: `Bearer ${token}`, origin: APP_ORIGIN },
      });
      expect(res.status).toBe(401);
    });

    it('does not let a cookie session skip the csrf check by adding a header', async () => {
      const login = await request('/api/field/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'dana@allstar.test', password: 'knock-knock' }),
      });
      const cookieToken = /lbi_field=([^;]*)/.exec(login.headers.get('set-cookie') ?? '')?.[1] ?? '';
      // The cookie is what the browser attaches on its own, so it is what
      // has to be defended. Repeating it in an Authorization header must not
      // reclassify the request as a bearer one.
      const res = await request('/api/field/visits', {
        method: 'POST',
        headers: {
          cookie: `lbi_field=${cookieToken}`,
          authorization: `Bearer ${cookieToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          clientUuid: 'uuid-native-0002',
          street: '9 Elm',
          disposition: 'no_answer',
          occurredAt: new Date().toISOString(),
        }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('cross origin access', () => {
    it('answers the app preflight for the field api', async () => {
      const res = await request('/api/field/visits', {
        method: 'OPTIONS',
        headers: {
          origin: APP_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization, content-type',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
      expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
    });

    // No ambient credential is ever allowed across origins. The app carries
    // a token; nothing rides along on its own.
    it('never allows credentials', async () => {
      const res = await request('/api/field/me', {
        headers: { origin: APP_ORIGIN, authorization: 'Bearer x' },
      });
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('leaves client reporting closed to the app origin', async () => {
      const res = await request('/api/tenant/field/overview', {
        method: 'OPTIONS',
        headers: { origin: APP_ORIGIN, 'access-control-request-method': 'GET' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('leaves the field api closed to any other website', async () => {
      const res = await request('/api/field/me', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
