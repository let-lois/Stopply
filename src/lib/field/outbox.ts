// The outbox: knocks the phone has taken but the server has not yet seen.
//
// A rep taps an outcome and the knock is written here first, synchronously as
// far as they are concerned, and sent whenever there is signal. That is the
// whole feature. Without it a knock in a stairwell is lost, and a rep who
// loses a few knocks stops logging them, which is worse than the knocks.
//
// IndexedDB rather than localStorage. localStorage is synchronous, so every
// write blocks the frame the rep is looking at, and it is the first thing a
// phone clears under memory pressure. A queue whose whole job is to survive is
// the wrong place to economise.
//
// Retrying forever is only safe because deviceVisitId is minted here, before
// the first attempt, and reused on every retry. The server recognises a knock
// it already holds by that id and answers success, so a drain cannot double
// count a door however many times it runs.

const DB_NAME = 'stopply-field';
const DB_VERSION = 1;
const STORE = 'outbox';

export interface QueuedKnock {
  /** Minted once, before the first send, and never regenerated. */
  deviceVisitId: string;
  propertyId: string;
  disposition: string;
  notes: string | null;
  /** The phone's clock at the door, not at send time. */
  occurredAt: string;
  /** For surfacing a knock that keeps failing rather than hiding it. */
  attempts: number;
  lastError: string | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'deviceVisitId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open the offline queue'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Offline queue write failed'));
    tx.oncomplete = () => db.close();
  });
}

export async function enqueue(knock: Omit<QueuedKnock, 'attempts' | 'lastError'>): Promise<void> {
  await withStore('readwrite', (store) =>
    store.put({ ...knock, attempts: 0, lastError: null } satisfies QueuedKnock)
  );
}

export async function listQueued(): Promise<QueuedKnock[]> {
  // getAll is typed as any[] by the DOM lib, so the cast is at the one place
  // the shape is known rather than spread over every caller.
  const all = await withStore<QueuedKnock[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<QueuedKnock[]>
  );
  // Oldest first, so a rep's day uploads in the order it happened.
  return all.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export async function remove(deviceVisitId: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(deviceVisitId));
}

export async function markAttempt(knock: QueuedKnock, error: string): Promise<void> {
  await withStore('readwrite', (store) =>
    store.put({ ...knock, attempts: knock.attempts + 1, lastError: error } satisfies QueuedKnock)
  );
}

export interface DrainResult {
  sent: number;
  remaining: number;
}

/**
 * Try to send everything queued.
 *
 * Stops at the first network failure rather than grinding through the whole
 * queue: if one send failed for want of signal the next will too, and the
 * retry will come round again soon enough.
 *
 * A knock the server refuses on its merits, though, is not a network problem
 * and never will be. A 4xx is removed from the queue, because a door that no
 * longer exists or is no longer in this rep's territory will be rejected
 * identically forever, and leaving it would block every knock behind it.
 */
export async function drain(
  send: (knock: QueuedKnock) => Promise<{ ok: true } | { ok: false; permanent: boolean; message: string }>
): Promise<DrainResult> {
  const queued = await listQueued();
  let sent = 0;

  for (const knock of queued) {
    const result = await send(knock);

    if (result.ok) {
      await remove(knock.deviceVisitId);
      sent++;
      continue;
    }

    if (result.permanent) {
      await remove(knock.deviceVisitId);
      console.warn('[outbox] dropped a knock the server refused', knock.deviceVisitId, result.message);
      continue;
    }

    await markAttempt(knock, result.message);
    break;
  }

  return { sent, remaining: (await listQueued()).length };
}
