// Versioned, validated localStorage.
//
// What persists, and why it is a closed list: the prototype saved clients and
// currentClientId and nothing else, so a refresh kept client configuration
// while silently discarding every logged visit, every new property, every
// credential, and the whole audit trail. A rep could knock a street, refresh,
// and find the morning gone.
//
// Everything the user creates now survives. The demo identity deliberately
// does not: it is a presentation device, and persisting it would make a
// simulated role look like a session.

import type { z } from 'zod';

const NAMESPACE = 'stopply';
const VERSION = 2;

export const STORAGE_KEYS = {
  clients: `${NAMESPACE}:clients`,
  currentClientId: `${NAMESPACE}:currentClientId`,
  properties: `${NAMESPACE}:properties`,
  visits: `${NAMESPACE}:visits`,
  audit: `${NAMESPACE}:audit`,
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

interface Envelope<T> {
  version: number;
  data: T;
}

/**
 * Upgrades a payload written by an older build.
 *
 * Version 2 reseeded the demo workspaces under different client ids, so a
 * version 1 payload would pin a browser to clients that no longer exist and
 * no amount of reseeding would dislodge it. Discarding is the correct
 * migration: the data is a demo, and the seed is better than a stale copy.
 *
 * The hook exists at all because the alternative, discovered later, is a key
 * named `_v1` with no way to move off it.
 */
function migrate(from: number, to: number, data: unknown): unknown {
  if (from === to) return data;
  // Nothing older is worth carrying forward. An unrecognised version is
  // discarded rather than guessed at, and the caller falls back to seed data.
  return undefined;
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof value.version === 'number' &&
    'data' in value
  );
}

/**
 * Reads a key, or returns undefined if anything at all is wrong with it.
 *
 * Corrupt storage must never reach render. Every failure path here is a
 * console warning and a discard, which is why hand-editing a value in
 * devtools produces seed data rather than a white screen.
 */
export function readStorage<S extends z.ZodType>(
  key: StorageKey,
  schema: S
): z.infer<S> | undefined {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // Private browsing, disabled storage, or a quota error on read.
    return undefined;
  }
  if (raw === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[storage] ${key} was not valid JSON, discarding`);
    return undefined;
  }

  if (!isEnvelope(parsed)) {
    console.warn(`[storage] ${key} had no version envelope, discarding`);
    return undefined;
  }

  const migrated = migrate(parsed.version, VERSION, parsed.data);
  if (migrated === undefined) {
    console.warn(`[storage] ${key} is version ${parsed.version}, cannot migrate, discarding`);
    return undefined;
  }

  const result = schema.safeParse(migrated);
  if (!result.success) {
    console.warn(`[storage] ${key} failed validation, discarding`, result.error.issues);
    return undefined;
  }
  return result.data;
}

export function writeStorage<T>(key: StorageKey, data: T): void {
  try {
    const envelope: Envelope<T> = { version: VERSION, data };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // A full quota must not break the interaction that triggered the write.
    console.warn(`[storage] could not write ${key}`);
  }
}

/**
 * Clears every key this module owns.
 *
 * All of them, deliberately. The prototype's reset cleared two keys while
 * resetting four pieces of in-memory state, so a reset left the app in a
 * condition no fresh load could reproduce.
 */
export function resetAll(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing useful to do; the next read validates anyway.
    }
  }
}
