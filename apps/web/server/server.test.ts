// Tests for the server's load-bearing parts.
//
// These are the pieces where being almost right is indistinguishable from
// being right until someone attacks it: path matching that decides which
// handler runs, cookie parsing that decides who you are, the scope filter
// that decides whose data you see, and the two places that must fail closed.

import { matchPath } from '@server/router';
import {
  hashPassword,
  isLegacyHash,
  needsRehash,
  verifyPassword,
} from '@server/crypto/password';
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
  it('verifies a correct password', async () => {
    const stored = hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = hashPassword('correct horse battery staple');
    await expect(verifyPassword('Correct horse battery staple', stored)).resolves.toBe(false);
  });

  it('salts, so the same password stores differently every time', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('records its parameters in the hash', () => {
    // The property, not the constants. Pinning the exact numbers made this
    // fail when the memory cost was lowered, which is a test objecting to a
    // deliberate change rather than catching a defect.
    expect(hashPassword('x')).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
  });

  it('uses one of the configurations OWASP treats as equivalent', () => {
    // This is the invariant worth guarding: the cost may be traded between
    // memory and passes, but not lowered to something off the list. A Workers
    // isolate caps at 128 MB and `m` is the working buffer in KiB, so this is
    // also what bounds how many people can sign in at once.
    const OWASP = ['m=47104,t=1,p=1', 'm=19456,t=2,p=1', 'm=12288,t=3,p=1', 'm=9216,t=4,p=1', 'm=7168,t=5,p=1'];
    const params = /^\$argon2id\$v=19\$(m=\d+,t=\d+,p=\d+)\$/.exec(hashPassword('x'))?.[1];
    expect(OWASP).toContain(params);
  });

  it('returns false rather than throwing on a hash it cannot parse', async () => {
    // A corrupt or unrecognised row has to be a failed login. Throwing would
    // be a 500, which tells an attacker the account exists.
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
    await expect(verifyPassword('x', '$argon2id$v=19$m=19456,t=2,p=1$!!!$!!!')).resolves.toBe(false);
  });

  it('rejects a hash whose stored digest has been altered', async () => {
    const stored = hashPassword('secret value');
    const tampered = stored.slice(0, -4) + (stored.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(verifyPassword('secret value', tampered)).resolves.toBe(false);
  });
});

describe('passwords carried over from the BI platform', () => {
  // A real hash in bi.letlois.com's format, generated with the same WebCrypto
  // calls that platform uses: PBKDF2-HMAC-SHA-256 at 100,000 iterations, the
  // Workers runtime cap. The password is "correct horse battery staple".
  const LEGACY =
    'pbkdf2$100000$3zJLlkGFHt1Q42gTkPPuYg==$5+AywGqW53z384d5WpCtjWObN/y61HI5uD6lkQBYILY=';

  it('accepts a password that works on the BI platform today', async () => {
    // Hashes cannot be converted between algorithms, so this is the only way
    // somebody's existing password can work here without them retyping it.
    await expect(verifyPassword('correct horse battery staple', LEGACY)).resolves.toBe(true);
  });

  it('still rejects the wrong password against a carried-over hash', async () => {
    await expect(verifyPassword('correct horse battery stapl', LEGACY)).resolves.toBe(false);
    await expect(verifyPassword('', LEGACY)).resolves.toBe(false);
  });

  it('recognises which hashes need upgrading, and which do not', () => {
    expect(isLegacyHash(LEGACY)).toBe(true);
    expect(isLegacyHash(hashPassword('x'))).toBe(false);
  });

  it('refuses an implausible iteration count', async () => {
    // Someone who could write this column could otherwise set iterations to 1
    // and make every hash cheap to forge offline. The count is read from the
    // row, so it has to be bounded rather than trusted.
    const weak = LEGACY.replace('$100000$', '$1$');
    await expect(verifyPassword('correct horse battery staple', weak)).resolves.toBe(false);
  });

  it('rejects a malformed legacy hash rather than throwing', async () => {
    await expect(verifyPassword('x', 'pbkdf2$100000$!!!$!!!')).resolves.toBe(false);
    await expect(verifyPassword('x', 'pbkdf2$notanumber$aaaa$bbbb')).resolves.toBe(false);
    await expect(verifyPassword('x', 'pbkdf2$100000$onlytwo')).resolves.toBe(false);
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

describe('needsRehash', () => {
  it('rewrites a hash carried over from the BI platform', () => {
    expect(needsRehash('pbkdf2$100000$c2FsdA==$aGFzaA==')).toBe(true);
  });

  it('rewrites an Argon2id hash made at a cost we have moved off', () => {
    // The case that matters. A stored hash carries its own parameters, so
    // lowering PARAMS does nothing for an existing password until login
    // rewrites it. Without this the 19 MB verifications outlive the change.
    expect(needsRehash('$argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==')).toBe(true);
  });

  it('leaves a hash already at the current cost alone', () => {
    const current = hashPassword('test1234');
    expect(needsRehash(current)).toBe(false);
  });

  it('does not ask for a rewrite of something it cannot parse', () => {
    // Only ever consulted after a successful compare, so an unparseable value
    // has already failed verification. Returning true would rewrite a row on
    // the strength of a hash nobody matched against.
    expect(needsRehash('not-a-hash')).toBe(false);
    expect(needsRehash('')).toBe(false);
  });

  it('produces a hash the same run can verify', async () => {
    const stored = hashPassword('correct horse');
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('wrong horse', stored)).toBe(false);
  });

  it('still verifies a hash made at the old cost', async () => {
    // Nobody is locked out by the parameter change: verification reads the
    // parameters out of the stored string rather than assuming the current
    // ones.
    const { argon2id } = await import('@noble/hashes/argon2.js');
    const salt = new Uint8Array(16).fill(3);
    const old = argon2id('test1234', salt, { m: 19456, t: 2, p: 1, dkLen: 32 });
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    const stored = `$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(old)}`;

    expect(await verifyPassword('test1234', stored)).toBe(true);
    expect(needsRehash(stored)).toBe(true);
  });
});
