import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { readStorage, resetAll, STORAGE_KEYS, writeStorage } from '@/lib/persistence/storage';

const schema = z.array(z.object({ id: z.string() }));

describe('storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('round-trips a validated value', () => {
    writeStorage(STORAGE_KEYS.clients, [{ id: 'a' }]);
    expect(readStorage(STORAGE_KEYS.clients, schema)).toEqual([{ id: 'a' }]);
  });

  it('returns undefined for a key that was never written', () => {
    expect(readStorage(STORAGE_KEYS.clients, schema)).toBeUndefined();
  });

  it('discards a hand-corrupted value instead of throwing', () => {
    // QA step 11: corrupt a value by hand, the app loads on seed data.
    window.localStorage.setItem(STORAGE_KEYS.clients, 'not json at all');
    expect(readStorage(STORAGE_KEYS.clients, schema)).toBeUndefined();
  });

  it('discards a value that parses but does not match the schema', () => {
    writeStorage(STORAGE_KEYS.clients, [{ wrong: 'shape' }]);
    expect(readStorage(STORAGE_KEYS.clients, schema)).toBeUndefined();
  });

  it('discards a payload written without a version envelope', () => {
    window.localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify([{ id: 'a' }]));
    expect(readStorage(STORAGE_KEYS.clients, schema)).toBeUndefined();
  });

  it('discards a payload from a version it cannot migrate', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.clients,
      JSON.stringify({ version: 99, data: [{ id: 'a' }] })
    );
    expect(readStorage(STORAGE_KEYS.clients, schema)).toBeUndefined();
  });

  it('clears every key it owns, not a subset', () => {
    for (const key of Object.values(STORAGE_KEYS)) writeStorage(key, [{ id: 'a' }]);
    resetAll();
    for (const key of Object.values(STORAGE_KEYS)) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
  });
});
