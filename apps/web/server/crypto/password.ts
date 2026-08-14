// Password hashing: Argon2id, pure JavaScript.
//
// The spec asks for Argon2id or bcrypt. Getting Argon2id onto this runtime
// took one discarded attempt worth recording, because the obvious choice does
// not work here:
//
//   hash-wasm and every other WASM-backed Argon2 instantiate their module
//   lazily, inside the first call, from an inlined byte array. workerd
//   refuses that with "Wasm code generation disallowed by embedder" -- it
//   only accepts WebAssembly imported at build time as a module. Confirmed
//   against wrangler pages dev, not assumed.
//
// @noble/hashes implements Argon2id in JavaScript, so there is no WASM to
// compile. Measured on this runtime at roughly 270ms per hash with the
// parameters below. That cost is the feature, and it is also why login is
// behind Turnstile and rate limiting: an endpoint that burns a quarter second
// of CPU per call is a denial of service vector if anyone may call it freely.

import { argon2id } from '@noble/hashes/argon2.js';

/**
 * Argon2id, at OWASP's m=9216, t=4, p=1.
 *
 * Not the m=19456, t=2 configuration this started on, and the reason is
 * memory rather than security. OWASP publishes several configurations it
 * treats as equivalent, trading memory against passes:
 *
 *     m=47104 t=1  |  m=19456 t=2  |  m=12288 t=3  |  m=9216 t=4  |  m=7168 t=5
 *
 * `m` is the size of Argon2's working buffer in KiB, by definition, and
 * measured here rather than assumed: at m=19456 @noble allocates 19.0 MB for
 * the duration of a single verification. A Cloudflare Workers isolate is
 * capped at 128 MB, so roughly six concurrent sign-ins exhausted it, the
 * runtime killed the isolate, and every request in flight came back as a 503
 * that no code in this repository produces. Spread-out sign-ins never
 * overlapped and always worked, which is what made it look intermittent.
 *
 * At m=9216 the buffer is 9.0 MB and the ceiling roughly doubles, for the
 * same strength and, measured on this machine, slightly less CPU.
 *
 * Encoded into every stored hash below, so changing these does not invalidate
 * existing passwords. Old hashes keep verifying at whatever they were made
 * with, which is also why login re-hashes on the way past: see needsRehash.
 */
const PARAMS = { m: 9216, t: 4, p: 1, dkLen: 32 } as const;
const SALT_BYTES = 16;

function toB64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Typed against a plain ArrayBuffer rather than ArrayBufferLike, because
// WebCrypto's BufferSource will not accept a view that might be backed by a
// SharedArrayBuffer.
function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Hash a password for storage.
 *
 * The returned string carries its own parameters and salt, so verification
 * never has to guess how a given hash was produced. Changing PARAMS affects
 * new passwords only; old ones keep verifying against what they were made
 * with.
 */
export function hashPassword(password: string): string {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = argon2id(password, salt, PARAMS);
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${toB64(salt)}$${toB64(hash)}`;
}

/**
 * Constant-time comparison.
 *
 * A === on two hashes leaks how many leading bytes matched through timing.
 * The window is small and the fix is four lines, so there is no argument for
 * the shortcut.
 */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Verify a password against a hash produced by the BI platform.
 *
 * bi.letlois.com stores `pbkdf2$iterations$saltB64$hashB64`, at 100,000
 * iterations of PBKDF2-HMAC-SHA-256, because that is the Workers runtime cap
 * (workers/api/src/crypto.ts in that repo).
 *
 * A hash cannot be converted between algorithms, so the only way for someone's
 * existing password to work here is for this server to be able to check the
 * old format. It reads the iteration count from the stored string rather than
 * assuming 100,000, so a row written under a different cap still verifies.
 */
async function verifyPbkdf2(password: string, stored: string): Promise<boolean> {
  const match = /^pbkdf2\$(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!match) return false;

  const [, iterationsRaw, saltRaw, hashRaw] = match;
  if (!iterationsRaw || !saltRaw || !hashRaw) return false;

  const iterations = Number(iterationsRaw);
  // An attacker who could write this column could otherwise set iterations to
  // 1 and make every hash cheap to forge offline.
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 1_000_000) return false;

  try {
    const expected = fromB64(hashRaw);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromB64(saltRaw), iterations, hash: 'SHA-256' },
      key,
      expected.length * 8
    );
    return equalBytes(new Uint8Array(bits), expected);
  } catch {
    return false;
  }
}

/** True for a hash in the BI platform's format, which login upgrades on use. */
export function isLegacyHash(stored: string): boolean {
  return stored.startsWith('pbkdf2$');
}

/**
 * Whether this hash should be rewritten at the next successful sign-in.
 *
 * True for the old PBKDF2 format, and also for an Argon2id hash made with
 * parameters we have since moved off. That second case is what actually
 * migrates the memory cost: a stored hash carries its own parameters, so
 * lowering PARAMS does nothing for anybody who already has a password until
 * their hash is rewritten. Without this, the 19 MB verifications would have
 * outlived the change indefinitely.
 *
 * Deliberately not "different in any way": only a hash whose cost differs
 * from the current one is rewritten, so a future change that only moves the
 * salt length does not churn every row.
 */
export function needsRehash(stored: string): boolean {
  if (isLegacyHash(stored)) return true;

  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  // Unparseable is not "needs a rehash": verification will already have
  // failed, and this is only ever consulted after a successful compare.
  if (!match) return false;

  return (
    Number(match[1]) !== PARAMS.m ||
    Number(match[2]) !== PARAMS.t ||
    Number(match[3]) !== PARAMS.p
  );
}

/**
 * Verify a password against a stored hash, in either format.
 *
 * Returns false for anything it cannot parse rather than throwing, so a
 * corrupt or legacy row is a failed login rather than a 500 that tells the
 * caller the account exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (isLegacyHash(stored)) return verifyPbkdf2(password, stored);

  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!match) return false;

  const [, mRaw, tRaw, pRaw, saltRaw, hashRaw] = match;
  if (!mRaw || !tRaw || !pRaw || !saltRaw || !hashRaw) return false;

  try {
    const expected = fromB64(hashRaw);
    const actual = argon2id(password, fromB64(saltRaw), {
      m: Number(mRaw),
      t: Number(tRaw),
      p: Number(pRaw),
      dkLen: expected.length,
    });
    return equalBytes(actual, expected);
  } catch {
    return false;
  }
}
