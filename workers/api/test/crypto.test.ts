import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  timingSafeEqual,
  encryptCredentials,
  decryptCredentials,
  sha256Hex,
  hmacSha256Hex,
  toBase64,
} from '../src/crypto';

describe('password hashing', () => {
  it('stores pbkdf2$iterations$saltB64$hashB64 with iterations capped at 100000', async () => {
    const stored = await hashPassword('correct horse battery staple');
    const parts = stored.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2');
    expect(Number(parts[1])).toBe(100000);
    expect(() => atob(parts[2]!)).not.toThrow();
    expect(() => atob(parts[3]!)).not.toThrow();
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const stored = await hashPassword('s3cret-pass');
    expect(await verifyPassword('s3cret-pass', stored)).toBe(true);
    expect(await verifyPassword('wrong-pass', stored)).toBe(false);
  });

  it('returns false for unknown users while still doing the derivation work', async () => {
    const start = performance.now();
    const result = await verifyPassword('anything', null);
    const elapsed = performance.now() - start;
    expect(result).toBe(false);
    // The dummy derivation must actually run; PBKDF2 at 100k iterations
    // cannot complete instantly.
    expect(elapsed).toBeGreaterThan(1);
  });

  it('produces unique salts per hash', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });
});

describe('timingSafeEqual', () => {
  it('compares equal and unequal byte arrays', () => {
    const enc = new TextEncoder();
    expect(timingSafeEqual(enc.encode('abc'), enc.encode('abc'))).toBe(true);
    expect(timingSafeEqual(enc.encode('abc'), enc.encode('abd'))).toBe(false);
    expect(timingSafeEqual(enc.encode('abc'), enc.encode('abcd'))).toBe(false);
  });
});

describe('credential vault', () => {
  const masterKey = toBase64(crypto.getRandomValues(new Uint8Array(32)));

  it('round trips credentials with AES-GCM and a fresh IV per record', async () => {
    const plaintext = JSON.stringify({ apiKey: 'blvd_live_abc123', businessId: 'b-1' });
    const a = await encryptCredentials(masterKey, plaintext);
    const b = await encryptCredentials(masterKey, plaintext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await decryptCredentials(masterKey, a.ciphertext, a.iv)).toBe(plaintext);
  });

  it('rejects a short master key', async () => {
    await expect(encryptCredentials(toBase64(new Uint8Array(16)), 'x')).rejects.toThrow();
  });
});

describe('hashing helpers', () => {
  it('sha256Hex and hmacSha256Hex produce stable hex', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    const sig = await hmacSha256Hex('key', 'message');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});
