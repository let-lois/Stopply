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

// OWASP's first recommended Argon2id configuration: 19 MiB, two passes, one
// lane. Encoded into every stored hash below, so raising them later does not
// invalidate existing passwords.
const PARAMS = { m: 19456, t: 2, p: 1, dkLen: 32 } as const;
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
