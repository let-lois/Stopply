// Sealing a credential.
//
// AES-256-GCM under a key held in a Worker binding. Note what this file does
// not export: there is no open(), unseal(), or decrypt().
//
// That is not an oversight and it is not "to be added later". §7 of the build
// spec is explicit that no HTTP route returns a secret value, and the
// cheapest way to guarantee that is for the code that could produce one not
// to exist. When an integration eventually needs to spend a credential, the
// decrypt belongs next to that outbound call, reading the row and using the
// value inside a single request, and it still never reaches a response body.
// Adding it here, unused, would make the property this file is protecting a
// matter of everyone remembering not to call something.

import { requireBinding, type Env } from '@server/env';

const IV_BYTES = 12;

async function loadKey(env: Env): Promise<CryptoKey> {
  const raw = requireBinding(env, 'CRED_MASTER_KEY');
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length !== 32) {
    throw new Error('CRED_MASTER_KEY must decode to exactly 32 bytes');
  }
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt']);
}

/**
 * Encrypt a secret for storage.
 *
 * The nonce is prepended to the ciphertext, so a row is self-describing and
 * nothing has to track nonces separately. GCM authenticates as well as
 * encrypts, so a tampered row fails to open rather than opening to garbage.
 */
export async function sealSecret(env: Env, secret: string): Promise<ArrayBuffer> {
  const key = await loadKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secret)
  );

  const out = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), IV_BYTES);
  return out.buffer;
}

/**
 * The last four characters of a secret, for display.
 *
 * This is the entire read surface of a credential, and it is computed once on
 * the way in rather than derived from storage on the way out, so no code path
 * that reads the table needs the plaintext at all.
 *
 * A value short enough that four characters would give away most of it gets
 * nothing instead.
 */
export function last4(secret: string): string {
  return secret.length >= 8 ? secret.slice(-4) : '';
}
