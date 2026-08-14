// The adapters, against a real server.
//
// Not a mocked fetch returning hand written objects. Those tests pass against
// whatever the person writing them believed the server did, which is the exact
// belief in question here: this app and the BI platform were built separately
// and disagree in ways that only show up on the wire. So these run
// qa/bi-api-fake.mjs as a real process and talk to it over HTTP, and that fake
// enforces the platform's actual rules, read out of its middleware.
//
// The one thing the fake is not is the production database. It answers the
// same shapes with different rows.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setCsrfToken, getCsrfToken, PlatformRequestError } from './wire';
import { fetchClients, toClient } from './clients';
import { fetchSession, signIn, signOut, mapRole } from './session';
import {
  withTenant,
  resetTenantContext,
  TenantSelectionError,
  fetchMe,
} from './tenantContext';
import { platformRequest } from './wire';
import { z } from 'zod';

// The fake is started for the whole run by qa/start-bi-fake.mjs, wired in as
// the app project's globalSetup.
const BASE = 'http://127.0.0.1:8791';

/**
 * A cookie jar, because node's fetch does not have one and the platform's
 * whole session model is a cookie. Without this the tests would pass a
 * stateless server and prove nothing about the stateful one.
 */
let jar = new Map<string, string>();

function installFetch() {
  const real: typeof fetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Every caller in this layer passes a string path. Narrowed rather than
    // stringified, because String() on a Request gives "[object Request]" and
    // the mistake would surface as a 404 against a nonsense URL.
    if (typeof input !== 'string') throw new Error('the test fetch expects a path');
    const url = input.startsWith('http') ? input : `${BASE}${input}`;
    const headers = new Headers(init?.headers);
    if (jar.size > 0) {
      headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    const response = await real(url, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const [name, ...rest] = setCookie.split(';')[0]!.split('=');
      const value = rest.join('=');
      // An empty value is the platform clearing the cookie on sign out, and
      // has to delete rather than store, or the jar keeps presenting a session
      // the server has already destroyed.
      if (value === '') jar.delete(name!);
      else jar.set(name!, value);
    }
    return response;
  };
}

beforeAll(() => {
  installFetch();
});

afterEach(() => {
  jar = new Map();
  setCsrfToken(null);
  resetTenantContext();
});

async function signInAsAgency() {
  return signIn('noah@letlois.com', 'whatever');
}

describe('sign in', () => {
  it('signs in and maps the agency admin to a super admin', async () => {
    const session = await signInAsAgency();
    expect(session.user.email).toBe('noah@letlois.com');
    expect(session.user.role).toBe('super_admin');
    // Null means every workspace. An agency admin is not bound to one, and
    // must not be: binding them would put a client's brand on their shell.
    expect(session.clientIds).toBeNull();
    expect(session.user.clientId).toBeNull();
  });

  it('holds a CSRF token in memory and nowhere else', async () => {
    await signInAsAgency();
    expect(getCsrfToken()).toBeTruthy();
    // The whole point of the module variable. If either of these ever holds
    // it, a stored XSS gets a CSRF token for free.
    expect(JSON.stringify(globalThis.localStorage ?? {})).not.toContain(getCsrfToken()!);
    expect(document.cookie).not.toContain(getCsrfToken()!);
  });

  it('does not send a Turnstile token, which the platform would reject', async () => {
    // The platform's loginSchema is .strict(). Sending our own challenge token
    // to it turns a correct password into a 400. Proven by sending one
    // directly and watching it fail, so the adapter's omission is a decision
    // and not an oversight nobody would notice.
    await expect(
      platformRequest('/api/auth/login', z.object({ ok: z.boolean() }), {
        method: 'POST',
        body: { email: 'noah@letlois.com', password: 'x', turnstileToken: 't' },
      })
    ).rejects.toMatchObject({ status: 400 });

    await expect(signInAsAgency()).resolves.toBeTruthy();
  });

  it('passes the platform’s own wording through on a bad password', async () => {
    // Not "the server could not be reached", which is what our client's
    // error parser produced before this layer existed: the platform's error
    // body is a bare string and did not match our { error: { code, message } }
    // shape, so every failure looked like an outage.
    await expect(signIn('nobody@example.invalid', 'x')).rejects.toMatchObject({
      status: 401,
      message: 'invalid email or password',
    });
  });

  it('keeps the redirect hint when a client user signs in on the wrong host', async () => {
    try {
      await signIn('marcus@allstar.example.invalid', 'x');
      throw new Error('should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformRequestError);
      expect((error as PlatformRequestError).redirectHost).toBe('allstar.bi.letlois.com');
    }
  });

  it('reports an unfamiliar role instead of quietly demoting the user', () => {
    expect(() => mapRole('something_new')).toThrow(/Unrecognized role/);
    expect(mapRole('agency_staff')).toBe('client_admin');
    expect(mapRole('account_admin')).toBe('client_admin');
  });
});

describe('the client list', () => {
  it('maps the four workspaces without inventing anything', async () => {
    await signInAsAgency();
    const clients = await fetchClients();
    expect(clients.map((c) => c.name)).toEqual([
      'Allstar',
      'Be Clinical',
      'Blue Cactus Power Washing',
      'TXD Roofing',
    ]);

    const allstar = clients[0]!;
    expect(allstar.plan).toBe('Starter');
    expect(allstar.timezone).toBe('America/Los_Angeles');
    // Absent in the platform, so absent here. Not a plausible filler.
    expect(allstar.industry).toBe('');
    expect(allstar.contactEmail).toBe('');
    expect(allstar.lastActive).toBeNull();
    expect(allstar.logo).toBeNull();
  });

  it('gives the advertising module only to clients that run ads', async () => {
    await signInAsAgency();
    const clients = await fetchClients();
    const byName = Object.fromEntries(clients.map((c) => [c.name, c]));
    // All Star runs no ads. Showing them an advertising dashboard full of
    // zeroes is the failure this guards.
    expect(byName['Allstar']!.enabledModules).toEqual(['field_sales']);
    expect(byName['Be Clinical']!.enabledModules).toContain('advertising');
    expect(byName['Blue Cactus Power Washing']!.enabledModules).toContain('advertising');
    expect(byName['TXD Roofing']!.enabledModules).toEqual(['field_sales']);
  });

  it('does not call an unfamiliar status active', () => {
    const row = {
      id: 't1',
      slug: 'x',
      name: 'X',
      status: 'suspended',
      plan: null,
      timezone: null,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    expect(toClient(row).status).toBe('paused');
    expect(toClient({ ...row, status: 'provisioning' }).status).toBe('onboarding');
  });
});

describe('reading one workspace', () => {
  const visitsSchema = z.object({ visits: z.array(z.object({ id: z.string() })) });

  it('refuses a tenant read with nothing selected', async () => {
    await signInAsAgency();
    // Straight at the endpoint, with no selection. This is the 400 that made
    // the naive port fail, and the reason withTenant exists.
    await expect(
      platformRequest('/api/tenant/field/visits', visitsSchema)
    ).rejects.toMatchObject({ status: 400, message: 'no tenant selected' });
  });

  it('selects the workspace, reads it, and follows the rotated CSRF token', async () => {
    await signInAsAgency();
    const afterLogin = getCsrfToken();

    const result = await withTenant('tn_allstar', () =>
      platformRequest('/api/tenant/field/visits', visitsSchema)
    );
    expect(result.visits.length).toBeGreaterThan(0);
    // Switching rotates the token. A layer that cached the login's would now
    // be sending a dead one, and the next write would be a 403.
    expect(getCsrfToken()).not.toBe(afterLogin);
    expect((await fetchMe()).tenantId).toBe('tn_allstar');
  });

  it('answers an empty roster for a client with no crew', async () => {
    await signInAsAgency();
    const repsSchema = z.object({ reps: z.array(z.unknown()) });
    const result = await withTenant('tn_beclinical', () =>
      platformRequest('/api/tenant/field/reps', repsSchema)
    );
    expect(result.reps).toEqual([]);
  });

  it('does not interleave two workspaces read at once', async () => {
    await signInAsAgency();
    // Both started before either finishes. Without the queue, the second
    // switch lands before the first read, and Allstar's card shows Be
    // Clinical's numbers.
    const [a, b] = await Promise.all([
      withTenant('tn_allstar', async () => {
        const r = await platformRequest('/api/tenant/field/visits', visitsSchema);
        return { asked: 'tn_allstar', count: r.visits.length };
      }),
      withTenant('tn_beclinical', async () => {
        const r = await platformRequest('/api/tenant/field/visits', visitsSchema);
        return { asked: 'tn_beclinical', count: r.visits.length };
      }),
    ]);
    expect(a.count).toBeGreaterThan(0);
    // Be Clinical has no crew, so no visits. If this came back non-zero it
    // would be Allstar's data under Be Clinical's name.
    expect(b.count).toBe(0);
  });

  it('refuses data that came back under a different workspace', async () => {
    await signInAsAgency();
    // What a second browser tab does: moves the shared session's selection
    // while this read is in flight. The queue cannot see it, so the check
    // after the read is what catches it.
    await expect(
      withTenant('tn_allstar', async () => {
        await platformRequest(
          '/api/auth/switch-tenant',
          z.object({ ok: z.boolean(), csrf: z.string(), tenant: z.unknown() }),
          { method: 'POST', body: { tenantId: 'tn_bluecactus' } }
        );
        return platformRequest('/api/tenant/field/visits', visitsSchema);
      })
    ).rejects.toBeInstanceOf(TenantSelectionError);
  });

  it('keeps working after a failed read', async () => {
    await signInAsAgency();
    await expect(
      withTenant('tn_allstar', () => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom');
    // The queue must not be wedged by the rejection above.
    const result = await withTenant('tn_allstar', () =>
      platformRequest('/api/tenant/field/visits', visitsSchema)
    );
    expect(result.visits.length).toBeGreaterThan(0);
  });
});

describe('the session, resumed', () => {
  it('reads back who is signed in', async () => {
    await signInAsAgency();
    const session = await fetchSession();
    expect(session.user.role).toBe('super_admin');
    expect(session.user.name).toBe('Noah Rance');
  });

  it('signs out and stops holding a token', async () => {
    await signInAsAgency();
    await signOut();
    expect(getCsrfToken()).toBeNull();
    await expect(fetchMe()).rejects.toMatchObject({ status: 401 });
  });
});
