// The rep's session and their doors, in one place.
//
// Deliberately not PlatformProvider. The rep app shares no state with the
// dashboard, and giving it its own provider is what keeps a phone from ever
// holding a client's roster, audit trail or credential list in memory.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { api, ApiRequestError } from '@/lib/api/client';
import { drain, enqueue, listQueued, type QueuedKnock } from '@/lib/field/outbox';
import {
  fieldDoorsSchema,
  logVisitResponseSchema,
  type dispositionSchema,
} from '@/modules/field-sales/contracts';

type FieldDoors = z.infer<typeof fieldDoorsSchema>;
export type Disposition = z.infer<typeof dispositionSchema>;
export type Door = FieldDoors['properties'][number];

const okSchema = z.object({ ok: z.boolean() });

const paths = {
  login: '/api/field/login',
  logout: '/api/field/logout',
  doors: '/api/field/doors',
  visits: '/api/field/visits',
} as const;

export type FieldStatus = 'checking' | 'signed-in' | 'signed-out';

export interface FieldState {
  status: FieldStatus;
  data: FieldDoors | null;
  error: string | null;
  /** Knocks taken but not yet accepted by the server. */
  pending: number;
  /** Whether the browser currently believes it has a connection. */
  online: boolean;
}

export interface FieldActions {
  signIn: (email: string, password: string, turnstileToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Record a knock.
   *
   * Never rejects for want of a connection. The knock is written to the phone
   * first and sent whenever there is signal, so a rep in a stairwell is not
   * shown a failure for something they did correctly.
   */
  logKnock: (input: { propertyId: string; disposition: Disposition; notes: string | null }) => Promise<void>;
  refresh: () => Promise<void>;
}

const StateContext = createContext<FieldState | undefined>(undefined);
const ActionsContext = createContext<FieldActions | undefined>(undefined);

export function FieldSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FieldState>({
    status: 'checking',
    data: null,
    error: null,
    pending: 0,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  });

  // The queue, mirrored in memory so the door list can show a knock the server
  // has not accepted yet. Held in a ref as well because the drain runs from
  // event listeners that must not be rebound every time it changes.
  const queuedRef = useRef<QueuedKnock[]>([]);

  /**
   * Overlay the queue on top of whatever the server said.
   *
   * Without this a refresh silently reverts every unsent knock: the server has
   * not heard about them, so its answer is the old outcome, and the rep watches
   * their morning undo itself. The queue is the newer truth until it drains.
   */
  const withQueued = useCallback((data: FieldDoors): FieldDoors => {
    if (queuedRef.current.length === 0) return data;
    const byProperty = new Map(queuedRef.current.map((k) => [k.propertyId, k]));
    return {
      ...data,
      properties: data.properties.map((p) => {
        const queued = byProperty.get(p.id);
        return queued ? { ...p, disposition: queued.disposition as Door['disposition'] } : p;
      }),
    };
  }, []);

  const apply = useCallback(
    (data: FieldDoors) => {
      setState((prev) => ({ ...prev, status: 'signed-in', data: withQueued(data), error: null }));
    },
    [withQueued]
  );

  const syncQueue = useCallback(async () => {
    queuedRef.current = await listQueued();
    setState((prev) => ({ ...prev, pending: queuedRef.current.length }));
  }, []);

  // runDrain is defined below but referenced by the boot effect above it, and
  // a ref is what lets the effect depend on nothing that changes. Without it
  // the effect re-runs on every drain and re-fetches the doors each time.
  const drainRef = useRef<() => Promise<void>>(async () => {});

  /** Send one queued knock, classifying the failure so the drain can decide. */
  const sendOne = useCallback(async (knock: QueuedKnock) => {
    try {
      await api.post(
        paths.visits,
        {
          deviceVisitId: knock.deviceVisitId,
          propertyId: knock.propertyId,
          disposition: knock.disposition,
          notes: knock.notes,
          occurredAt: knock.occurredAt,
        },
        logVisitResponseSchema
      );
      return { ok: true } as const;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        // 401 is not permanent in the sense that matters: the rep can sign in
        // again and the knock is still good. 4xx otherwise means the server
        // will refuse this knock identically forever.
        const permanent = error.status >= 400 && error.status < 500 && error.status !== 401;
        return { ok: false, permanent, message: error.message } as const;
      }
      return { ok: false, permanent: false, message: 'offline' } as const;
    }
  }, []);

  const runDrain = useCallback(async () => {
    if (queuedRef.current.length === 0) return;
    const result = await drain(sendOne);
    await syncQueue();
    // Only worth a round trip if something actually landed.
    if (result.sent > 0) {
      try {
        apply(await api.get(paths.doors, fieldDoorsSchema));
      } catch {
        // The knocks are recorded; the refresh can wait for the next attempt.
      }
    }
  }, [sendOne, syncQueue, apply]);

  useEffect(() => {
    drainRef.current = runDrain;
  }, [runDrain]);

  // Boot: read the queue, ask who we are, and send anything still waiting.
  //
  // That last part is not optional. A rep who closes the app in a dead zone
  // and opens it an hour later in signal would otherwise sit on a full queue
  // until the sixty second timer came round or they happened to log another
  // knock, which is exactly the moment they are checking whether their morning
  // made it.
  useEffect(() => {
    const controller = new AbortController();

    void syncQueue().then(() => drainRef.current());

    api
      .get(paths.doors, fieldDoorsSchema, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) apply(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState((prev) => ({ ...prev, status: 'signed-out', data: null }));
        }
      });

    return () => controller.abort();
  }, [apply, syncQueue]);

  // Drain whenever there is a reason to think it might work: the connection
  // came back, the rep returned to the app, or a few minutes passed. None of
  // these is reliable on its own, which is why there are three.
  useEffect(() => {
    const onOnline = () => {
      setState((prev) => ({ ...prev, online: true }));
      void runDrain();
    };
    const onOffline = () => setState((prev) => ({ ...prev, online: false }));
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runDrain();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => void runDrain(), 60000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [runDrain]);

  const signIn = useCallback<FieldActions['signIn']>(
    async (email, password, turnstileToken) => {
      apply(await api.post(paths.login, { email, password, turnstileToken }, fieldDoorsSchema));
      // A rep who was signed out with knocks still queued gets them sent now.
      void runDrain();
    },
    [apply, runDrain]
  );

  const signOut = useCallback(async () => {
    try {
      await api.post(paths.logout, {}, okSchema);
    } catch (error) {
      // Signing out must not be blockable by a bad connection, which is the
      // normal condition for this app.
      if (!(error instanceof ApiRequestError)) throw error;
    }
    // The queue deliberately survives. Those knocks belong to the rep who took
    // them and will send when they sign back in; clearing it here would throw
    // away a morning's work to tidy up.
    setState((prev) => ({ ...prev, status: 'signed-out', data: null }));
  }, []);

  const refresh = useCallback(async () => {
    apply(await api.get(paths.doors, fieldDoorsSchema));
  }, [apply]);

  const logKnock = useCallback<FieldActions['logKnock']>(
    async (input) => {
      // Minted here, on the device, before the first send, and reused on every
      // retry. The server recognises a knock it already holds by this id, so
      // the queue can retry forever without double counting a door.
      const deviceVisitId = `dev_${crypto.randomUUID()}`;
      const occurredAt = new Date().toISOString();

      // Written to the phone before anything is attempted. This is the line
      // that makes a knock in a dead zone survive.
      await enqueue({
        deviceVisitId,
        propertyId: input.propertyId,
        disposition: input.disposition,
        notes: input.notes,
        occurredAt,
      });
      await syncQueue();

      // Shown as done immediately, because from the rep's side it is: the
      // knock is recorded and will arrive. Making them wait on the network
      // would be showing them a lie the other way.
      setState((prev) => {
        if (!prev.data) return prev;
        return {
          ...prev,
          data: {
            ...prev.data,
            properties: prev.data.properties.map((p) =>
              p.id === input.propertyId ? { ...p, disposition: input.disposition } : p
            ),
            visits: [
              {
                id: deviceVisitId,
                propertyId: input.propertyId,
                repId: prev.data.session.repId,
                disposition: input.disposition,
                notes: input.notes,
                occurredAt,
              },
              ...prev.data.visits,
            ],
          },
        };
      });

      void runDrain();
    },
    [syncQueue, runDrain]
  );

  const actions = useMemo<FieldActions>(
    () => ({ signIn, signOut, logKnock, refresh }),
    [signIn, signOut, logKnock, refresh]
  );

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
}

export function useField(): FieldState {
  const value = useContext(StateContext);
  if (!value) throw new Error('useField must be used inside FieldSessionProvider');
  return value;
}

export function useFieldActions(): FieldActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useFieldActions must be used inside FieldSessionProvider');
  return value;
}
