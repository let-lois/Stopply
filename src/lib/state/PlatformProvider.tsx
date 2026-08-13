// Platform state: clients, users, audit, credential references.
//
// Split from field-sales state by update frequency. The prototype had one
// context carrying eleven values and eleven inline action functions in a
// fresh object literal with nothing memoized, so logging a single door knock
// re-rendered every consumer including every mounted chart.
//
// Read state and actions are separate contexts, so a component that only
// dispatches does not re-render when the data changes.
//
// Phase 2 changed where all of this comes from and nothing about its shape.
// usePlatform() returns what it always returned, so no page in the
// application was touched: the clients now arrive from the server, scoped to
// the session, and the audit trail is written by the server rather than
// appended locally and hoped about. That is the same seam argument as
// useModuleData, applied one level up.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  AuditLogEntry,
  Client,
  CredentialRef,
  DataMode,
  ModuleId,
  PlatformUser,
} from '@/types';
import { api } from '@/lib/api/client';
import { apiPaths } from '@/lib/api/paths';
import {
  auditResponseSchema,
  clientsResponseSchema,
  credentialsResponseSchema,
  teamResponseSchema,
} from '@/lib/api/contracts';
import type { createClientRequestSchema } from '@/lib/api/contracts';
import { useSession } from '@/lib/auth/SessionProvider';
import type { z } from 'zod';

/** What creating a workspace needs. The server's own request shape. */
export type CreateClientInput = z.infer<typeof createClientRequestSchema>;

export interface PlatformState {
  clients: Client[];
  users: PlatformUser[];
  auditLog: AuditLogEntry[];
  credentialRefs: CredentialRef[];
  currentUser: PlatformUser | null;
  isLoading: boolean;
  error: Error | null;
}

export interface PlatformActions {
  setModuleEnabled: (clientId: string, moduleId: ModuleId, enabled: boolean) => Promise<void>;
  setClientDataMode: (clientId: string, mode: DataMode) => Promise<void>;
  createClient: (input: CreateClientInput) => Promise<void>;
  /** Re-read everything the server owns. Called after any write. */
  refresh: () => Promise<void>;
}

const StateContext = createContext<PlatformState | undefined>(undefined);
const ActionsContext = createContext<PlatformActions | undefined>(undefined);

const EMPTY: Omit<PlatformState, 'currentUser' | 'isLoading' | 'error'> = {
  clients: [],
  users: [],
  auditLog: [],
  credentialRefs: [],
};

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const { status, user } = useSession();

  // Identifies the load the current render needs: who is signed in, or
  // nobody. What is on screen is then derived by comparing it against what
  // has actually arrived, rather than cleared with a setState at the top of
  // an effect, which cascades a render on every sign-in and sign-out.
  const requestKey = status === 'signed-in' && user ? user.id : null;

  const [loaded, setLoaded] = useState<{ key: string; values: typeof EMPTY } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    // Four independent reads, each already scoped by the server to the
    // session. Fetched together rather than in sequence: they are
    // independent, and four round trips in series is the difference between
    // a page that appears and a page that assembles.
    const [clients, team, audit, credentials] = await Promise.all([
      api.get(apiPaths.clients(), clientsResponseSchema, signal),
      api.get(apiPaths.team(), teamResponseSchema, signal),
      api.get(apiPaths.audit(), auditResponseSchema, signal),
      api.get(apiPaths.credentials(), credentialsResponseSchema, signal),
    ]);

    return {
      clients: clients.clients,
      users: team.users,
      auditLog: audit.entries,
      credentialRefs: credentials.credentials,
    };
  }, []);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();

    load(controller.signal)
      .then((values) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, values });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause : new Error('Could not load the platform.'));
      });

    return () => controller.abort();
  }, [requestKey, load]);

  // A result belonging to a previous session is not this render's result.
  const settled = loaded?.key === requestKey && requestKey !== null ? loaded : null;
  const data = settled?.values ?? EMPTY;

  const refresh = useCallback(async () => {
    if (!requestKey) return;
    setLoaded({ key: requestKey, values: await load() });
  }, [requestKey, load]);

  // Every write produces an entry, and it is the server's copy that counts.
  // Re-reading it is cheaper and more honest than appending a guess locally
  // and hoping it matches what was recorded.
  const patch = useCallback(
    (values: Partial<typeof EMPTY>) => {
      setLoaded((prev) => (prev ? { ...prev, values: { ...prev.values, ...values } } : prev));
    },
    []
  );

  const refreshAudit = useCallback(async () => {
    const audit = await api.get(apiPaths.audit(), auditResponseSchema);
    patch({ auditLog: audit.entries });
  }, [patch]);

  const setModuleEnabled = useCallback<PlatformActions['setModuleEnabled']>(
    async (clientId, moduleId, enabled) => {
      // The server is the one that decides, records the change on the trail,
      // and returns the new truth. The prototype toggled a local array and
      // wrote its own audit entry from inside a state updater, which
      // StrictMode duplicated.
      const response = await api.patch(
        apiPaths.clientModules(clientId),
        { moduleId, enabled },
        clientsResponseSchema
      );
      patch({ clients: response.clients });
      await refreshAudit();
    },
    [patch, refreshAudit]
  );

  const setClientDataMode = useCallback<PlatformActions['setClientDataMode']>(
    async (clientId, mode) => {
      const response = await api.patch(
        apiPaths.clientDataMode(clientId),
        { dataMode: mode },
        clientsResponseSchema
      );
      patch({ clients: response.clients });
      await refreshAudit();
    },
    [patch, refreshAudit]
  );

  const createClient = useCallback<PlatformActions['createClient']>(
    async (input) => {
      const response = await api.post(apiPaths.clients(), input, clientsResponseSchema);
      patch({ clients: response.clients });
      await refreshAudit();
    },
    [patch, refreshAudit]
  );

  const state = useMemo<PlatformState>(
    () => ({
      ...data,
      // Identical shapes; SessionUser is what a PlatformUser is once a server
      // is the one asserting it.
      currentUser: user,
      isLoading: status === 'checking' || (requestKey !== null && settled === null && !error),
      error,
    }),
    [data, user, status, requestKey, settled, error]
  );

  const actions = useMemo<PlatformActions>(
    () => ({ setModuleEnabled, setClientDataMode, createClient, refresh }),
    [setModuleEnabled, setClientDataMode, createClient, refresh]
  );

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
}

export function usePlatform(): PlatformState {
  const value = useContext(StateContext);
  if (!value) throw new Error('usePlatform must be used inside PlatformProvider');
  return value;
}

export function usePlatformActions(): PlatformActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('usePlatformActions must be used inside PlatformProvider');
  return value;
}

/** Undefined for an id that does not exist, so the guard can 404 it. */
export function useClient(clientId: string | undefined): Client | undefined {
  const { clients } = usePlatform();
  return useMemo(() => clients.find((c) => c.id === clientId), [clients, clientId]);
}
