// Tests for the server's load-bearing parts.
//
// These are the pieces where being almost right is indistinguishable from
// being right until someone attacks it: path matching that decides which
// handler runs, cookie parsing that decides who you are, the scope filter
// that decides whose data you see, and the two places that must fail closed.

import { matchPath } from '@server/router';
import { hashPassword, verifyPassword } from '@server/crypto/password';
import { readCookie, scopeFilter, SESSION_COOKIE, type Session } from '@server/db/scope';
import { sealSecret, last4 } from '@server/crypto/seal';
import { requireBinding, MissingBindingError, type Env } from '@server/env';
import { verifyTurnstile } from '@server/turnstile';
import { ApiError } from '@server/http';

function sessionFor(clientIds: string[] | null): Session {
  return {
    sessionId: 's',
    user: {
      id: 'u1',
      name: 'Test',
      email: 't@example.invalid',
      role: clientIds === null ? 'super_admin' : 'client_admin',
      clientId: clientIds?.[0] ?? null,
      status: 'active',
    },
    scopedClientIds: clientIds,
  };
}

const req = (headers: Record<string, string> = {}) =>
  new Request('https://stopply.test/api/x', { headers });

describe('the server test environment', () => {
  it('has no DOM', () => {
    // Locks in the vitest project split. These handlers run on workerd. A
    // test that passes because jsdom supplied a global workerd does not have
    // is a test that reports a green build for code that 500s in production.
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof globalThis.window).toBe('undefined');
  });
});

describe('matchPath', () => {
  it('binds named parameters', () => {
    expect(matchPath('/api/clients/:clientId/modules', '/api/clients/cl_1/modules')).toEqual({
      clientId: 'cl_1',
    });
  });

  it('refuses a path with a different number of segments', () => {
    // Without the length check /api/clients would match
    // /api/clients/:clientId and serve the list where a caller asked for one.
    expect(matchPath('/api/clients/:clientId', '/api/clients')).toBeNull();
    expect(matchPath('/api/clients', '/api/clients/cl_1')).toBeNull();
  });

  it('refuses an empty parameter rather than binding the empty string', () => {
    // /api/clients//data would otherwise set clientId to '', and every scope
    // comparison downstream would run against a value that matches nothing
    // and reads as a legitimate id.
    expect(matchPath('/api/clients/:clientId/field-sales/data', '/api/clients//field-sales/data'))
      .toBeNull();
  });

  it('does not confuse a literal segment with a parameter', () => {
    expect(matchPath('/api/auth/login', '/api/auth/logout')).toBeNull();
  });

  it('decodes an encoded parameter', () => {
    expect(matchPath('/api/credentials/:id', '/api/credentials/a%2Fb')).toEqual({ id: 'a/b' });
  });
});

describe('readCookie', () => {
  it('reads the named cookie', () => {
    const r = req({ cookie: `a=1; ${SESSION_COOKIE}=tok3n; b=2` });
    expect(readCookie(r, SESSION_COOKIE)).toBe('tok3n');
  });

  it('does not match a cookie whose name merely ends with the target', () => {
    // A substring match, which is the usual shortcut, would let an attacker
    // who can set x_stopply_session on a sibling subdomain supply the session.
    const r = req({ cookie: `x_${SESSION_COOKIE}=attacker` });
    expect(readCookie(r, SESSION_COOKIE)).toBeNull();
  });

  it('keeps a value that contains an equals sign', () => {
    const r = req({ cookie: `${SESSION_COOKIE}=a=b=c` });
    expect(readCookie(r, SESSION_COOKIE)).toBe('a=b=c');
  });

  it('returns null with no cookie header at all', () => {
    expect(readCookie(req(), SESSION_COOKIE)).toBeNull();
  });
});

describe('scopeFilter', () => {
  it('lets a super admin see everything', () => {
    expect(scopeFilter(sessionFor(null))).toEqual({ sql: '1 = 1', bindings: [] });
  });

  it('restricts a client-scoped session to its own client', () => {
    const filter = scopeFilter(sessionFor(['cl_1']));
    expect(filter.sql).toBe('client_id IN (?1)');
    expect(filter.bindings).toEqual(['cl_1']);
  });

  it('matches nothing for a session with no clients', () => {
    // The dangerous failure would be an empty IN () list, which is a SQL
    // syntax error, or a dropped WHERE clause, which returns everything.
    expect(scopeFilter(sessionFor([])).sql).toBe('1 = 0');
  });
});

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('Correct horse battery staple', stored)).toBe(false);
  });

  it('salts, so the same password stores differently every time', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('records its parameters in the hash', () => {
    expect(hashPassword('x')).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('returns false rather than throwing on a hash it cannot parse', () => {
    // A corrupt or legacy row has to be a failed login. Throwing would be a
    // 500, which tells an attacker the account exists.
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', '$argon2id$v=19$m=19456,t=2,p=1$!!!$!!!')).toBe(false);
  });

  it('rejects a hash whose stored digest has been altered', () => {
    const stored = hashPassword('secret value');
    const tampered = stored.slice(0, -4) + (stored.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(verifyPassword('secret value', tampered)).toBe(false);
  });
});

describe('credential sealing', () => {
  const env: Env = { DB: null as never, CRED_MASTER_KEY: btoa('0123456789abcdef0123456789abcdef') };

  it('produces a different ciphertext each time', async () => {
    // A fixed nonce under one key leaks whether two clients stored the same
    // token.
    const a = new Uint8Array(await sealSecret(env, 'sk_live_example'));
    const b = new Uint8Array(await sealSecret(env, 'sk_live_example'));
    expect(a).not.toEqual(b);
  });

  it('refuses to run without the key rather than storing plaintext', async () => {
    await expect(sealSecret({ DB: null as never }, 'x')).rejects.toBeInstanceOf(
      MissingBindingError
    );
  });

  it('refuses a key that is not 32 bytes', async () => {
    await expect(sealSecret({ DB: null as never, CRED_MASTER_KEY: btoa('short') }, 'x')).rejects.toThrow(
      /32 bytes/
    );
  });

  it('shows the last four only when there is enough to hide', () => {
    expect(last4('sk_live_abcd1234')).toBe('1234');
    // Four of seven characters is most of the secret.
    expect(last4('short12')).toBe('');
  });

  it('exports no way to read a sealed value back', async () => {
    const module: Record<string, unknown> = await import('@server/crypto/seal');
    // §7: the read path does not exist, so there is nothing to guard.
    expect(Object.keys(module).sort()).toEqual(['last4', 'sealSecret']);
  });
});

describe('required bindings', () => {
  it('throws for a missing binding instead of returning a falsy value', () => {
    expect(() => requireBinding({ DB: null as never }, 'TURNSTILE_SECRET')).toThrow(
      MissingBindingError
    );
  });

  it('throws for an empty string, which is the shape a blank secret takes', () => {
    expect(() => requireBinding({ DB: null as never, TURNSTILE_SECRET: '' }, 'TURNSTILE_SECRET'))
      .toThrow(MissingBindingError);
  });
});

describe('Turnstile', () => {
  const request = new Request('https://stopply.test/api/auth/login', { method: 'POST' });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails closed when the secret is not configured', async () => {
    // The whole point. `if (env.TURNSTILE_SECRET)` would return here having
    // verified nothing, and the endpoint would be open in exactly the
    // environment where somebody forgot to set it.
    await expect(verifyTurnstile({ DB: null as never }, request, 'token')).rejects.toBeInstanceOf(
      MissingBindingError
    );
  });

  const configured: Env = { DB: null as never, TURNSTILE_SECRET: 'secret' };

  it('rejects an empty token', async () => {
    await expect(verifyTurnstile(configured, request, '')).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects when Cloudflare says the token is bad', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), {
        status: 200,
      })
    );
    await expect(verifyTurnstile(configured, request, 'bad')).rejects.toThrow(/Challenge failed/);
  });

  it('rejects when the verifier is unreachable', async () => {
    // An outage at the verifier must not become an open door.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(verifyTurnstile(configured, request, 'good')).rejects.toThrow(/Could not verify/);
  });

  it('rejects when the verifier answers with an error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(verifyTurnstile(configured, request, 'good')).rejects.toThrow(/Could not verify/);
  });

  it('passes only on an explicit success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    await expect(verifyTurnstile(configured, request, 'good')).resolves.toBeUndefined();
  });

  it('sends verification to Cloudflare by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await verifyTurnstile(configured, request, 'good');
    expect(spy.mock.calls[0]?.[0]).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    );
  });

  it('ignores the endpoint override in production', async () => {
    // The override exists so a sandbox that cannot reach Cloudflare can still
    // exercise the login path against a stub. If it were honoured in
    // production it would be the fail-open hole this module exists to avoid,
    // so production ignores it whatever it is set to.
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await verifyTurnstile(
      { ...configured, ENVIRONMENT: 'production', TURNSTILE_VERIFY_URL: 'https://evil.test/yes' },
      request,
      'good'
    );

    expect(spy.mock.calls[0]?.[0]).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    );
  });

  it('honours the override outside production', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await verifyTurnstile(
      { ...configured, ENVIRONMENT: 'development', TURNSTILE_VERIFY_URL: 'http://127.0.0.1:9999/v' },
      request,
      'good'
    );
    expect(spy.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9999/v');
  });

  it('still requires the secret when the override is set', async () => {
    // Moving the destination must not remove the requirement.
    await expect(
      verifyTurnstile(
        { DB: null as never, TURNSTILE_VERIFY_URL: 'http://127.0.0.1:9999/v' },
        request,
        'good'
      )
    ).rejects.toBeInstanceOf(MissingBindingError);
  });

  it('does not treat a merely truthy success field as a pass', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: 'yes' }), { status: 200 })
    );
    await expect(verifyTurnstile(configured, request, 'good')).rejects.toThrow(/Challenge failed/);
  });
});
