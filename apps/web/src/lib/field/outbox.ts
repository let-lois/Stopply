// The offline outbox.
//
// This is what makes the app usable at a door. Reps work basements, stucco
// neighbourhoods, and dead zones; a knock that needed a live connection to
// be recorded would be lost several times a shift. So nothing is ever sent
// directly: a visit is written to the queue first, the rep gets their
// confirmation from the queue, and the network is a background detail.
//
// The queue is the source of truth until the server acknowledges. It
// survives a reload, a crash, and the phone being locked, because it lives
// in localStorage rather than in React state.

import { FieldApiError, FieldOfflineError, fieldApi } from './api';
import type { OutboxEntry, QueuedVisit } from './types';

const KEY = 'stopply.field.outbox.v1';
// A phone that has been out of signal all day can build a real backlog; a
// runaway loop should still not be able to fill the origin's storage quota.
const MAX_ENTRIES = 500;

type Listener = (entries: OutboxEntry[]) => void;
const listeners = new Set<Listener>();

function read(): OutboxEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    // Corrupt storage must not brick the app. Better to start clean than to
    // leave a rep unable to log anything.
    return [];
  }
}

function write(entries: OutboxEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Quota exhausted. The in memory copy still drains, and dropping the
    // write is better than throwing out of the submit handler.
  }
  for (const listener of listeners) listener(entries);
}

export function getOutbox(): OutboxEntry[] {
  return read();
}

export function pendingCount(): number {
  return read().filter((e) => !e.rejected).length;
}

export function rejectedEntries(): OutboxEntry[] {
  return read().filter((e) => e.rejected);
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Queues a visit and returns immediately. The caller does not wait for the
// network, which is the whole point: the rep is already walking to the next
// door.
export function enqueue(visit: QueuedVisit): void {
  const entries = read();
  // Guard against a double tap on the log button producing two rows for one
  // knock before either has left the queue.
  if (entries.some((e) => e.visit.clientUuid === visit.clientUuid)) return;
  write([...entries, { visit, attempts: 0, lastError: null, rejected: false }]);
}

export function discard(clientUuid: string): void {
  write(read().filter((e) => e.visit.clientUuid !== clientUuid));
}

export function discardRejected(): void {
  write(read().filter((e) => !e.rejected));
}

let flushing = false;

export interface FlushResult {
  sent: number;
  remaining: number;
  rejected: number;
  offline: boolean;
}

// Drains the queue oldest first.
//
// Order matters: visits go out in the order they were logged so a door's
// history reads the way the day actually went. A single entry that cannot
// be sent stops the pass rather than skipping ahead, except when the server
// has rejected it outright, which no amount of retrying will change.
export async function flush(): Promise<FlushResult> {
  if (flushing) {
    const entries = read();
    return {
      sent: 0,
      remaining: entries.filter((e) => !e.rejected).length,
      rejected: entries.filter((e) => e.rejected).length,
      offline: false,
    };
  }
  flushing = true;
  let sent = 0;
  let offline = false;

  try {
    for (;;) {
      const entries = read();
      const next = entries.find((e) => !e.rejected);
      if (!next) break;

      try {
        // A duplicate answers 200 rather than an error, so a visit the
        // server already has still clears the queue. That is the property
        // that lets this retry indefinitely without ever double counting.
        await fieldApi('/api/field/visits', { method: 'POST', json: next.visit });
        write(read().filter((e) => e.visit.clientUuid !== next.visit.clientUuid));
        sent++;
      } catch (err) {
        if (err instanceof FieldOfflineError) {
          // Still no signal. Leave everything queued and try again later.
          offline = true;
          bump(next.visit.clientUuid, err.message, false);
          break;
        }
        if (err instanceof FieldApiError) {
          // 401 means the session lapsed, which is recoverable by signing
          // back in, so the visit is kept rather than thrown away.
          if (err.status === 401 || err.status === 429) {
            bump(next.visit.clientUuid, err.message, false);
            offline = true;
            break;
          }
          // Anything else is the server refusing this specific visit. Mark
          // it so the rep can see it and fix it, and move on to the rest of
          // the queue instead of blocking behind it forever.
          bump(next.visit.clientUuid, err.message, true);
          continue;
        }
        bump(next.visit.clientUuid, 'unexpected error', true);
      }
    }
  } finally {
    flushing = false;
  }

  const entries = read();
  return {
    sent,
    remaining: entries.filter((e) => !e.rejected).length,
    rejected: entries.filter((e) => e.rejected).length,
    offline,
  };
}

function bump(clientUuid: string, error: string, rejected: boolean): void {
  write(
    read().map((e) =>
      e.visit.clientUuid === clientUuid
        ? { ...e, attempts: e.attempts + 1, lastError: error, rejected }
        : e
    )
  );
}

// Retries a visit the server refused, after the rep has corrected it.
export function requeue(clientUuid: string, visit: QueuedVisit): void {
  write(
    read().map((e) =>
      e.visit.clientUuid === clientUuid ? { visit, attempts: 0, lastError: null, rejected: false } : e
    )
  );
}

// Starts draining whenever there is a plausible reason to think it might
// work: the browser reported connectivity, the rep came back to the app, or
// enough time has passed. Returns a teardown for the effect that owns it.
export function startAutoFlush(onResult?: (result: FlushResult) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const run = () => {
    void flush().then((r) => onResult?.(r));
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };

  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  // The backstop for the case the events miss: a phone can regain a usable
  // connection without ever firing 'online', and captive portals lie.
  const timer = window.setInterval(run, 30000);
  run();

  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}

// Crypto grade ids, with a fallback for the older mobile browsers that
// still turn up on work phones and do not expose randomUUID.
export function newClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
}
