// All credential and password cryptography for the platform.
// PBKDF2 via Web Crypto for passwords, capped at the Workers runtime
// iteration limit. AES-GCM for the integration credential vault.

const PBKDF2_ITERATIONS = 100000; // Workers runtime cap
const PBKDF2_HASH = 'SHA-256';
const PBKDF2_KEYLEN = 32;

const encoder = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function randomToken(bytes = 32): string {
  return toHex(randomBytes(bytes));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: PBKDF2_HASH },
    keyMaterial,
    PBKDF2_KEYLEN * 8
  );
  return new Uint8Array(bits);
}

// Stored format: pbkdf2$iterations$saltB64$hashB64
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// A fixed dummy hash so verification work is constant whether or not the
// email exists. Callers pass null for unknown users; we still derive.
const DUMMY_HASH = `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(new Uint8Array(16))}$${toBase64(new Uint8Array(32))}`;

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const record = stored ?? DUMMY_HASH;
  const parts = record.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Math.min(parseInt(parts[1] ?? '0', 10) || PBKDF2_ITERATIONS, PBKDF2_ITERATIONS);
  const salt = fromBase64(parts[2] ?? '');
  const expected = fromBase64(parts[3] ?? '');
  const actual = await pbkdf2(password, salt, iterations);
  const match = timingSafeEqual(actual, expected);
  return stored === null ? false : match;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return toHex(new Uint8Array(sig));
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

// Credential vault. AES-GCM with a random 12 byte IV per record. The key
// comes from the CRED_MASTER_KEY secret (32 bytes, base64).
async function vaultKey(masterKeyB64: string): Promise<CryptoKey> {
  const raw = fromBase64(masterKeyB64);
  if (raw.length !== 32) throw new Error('CRED_MASTER_KEY must be 32 bytes base64');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptCredentials(
  masterKeyB64: string,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const key = await vaultKey(masterKeyB64);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encoder.encode(plaintext)
  );
  return { ciphertext: toBase64(new Uint8Array(ct)), iv: toBase64(iv) };
}

export async function decryptCredentials(
  masterKeyB64: string,
  ciphertextB64: string,
  ivB64: string
): Promise<string> {
  const key = await vaultKey(masterKeyB64);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64) as BufferSource },
    key,
    fromBase64(ciphertextB64) as BufferSource
  );
  return new TextDecoder().decode(pt);
}
