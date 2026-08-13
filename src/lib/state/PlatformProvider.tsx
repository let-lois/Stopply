// Platform state: clients, users, audit, credential references.
//
// Split from field-sales state by update frequency. The prototype had one
// context carrying eleven values and eleven inline action functions in a
// fresh object literal with nothing memoized, so logging a single door knock
// re-rendered every consumer including every mounted chart.
//
// Read state and actions are separate contexts, so a component that only
// dispatches does not re-render when the data changes.

import { createContext, useCallback, useContext, useMemo, useReducer, useState } from 'react';
import type { AuditAction, AuditLogEntry, Client, CredentialRef, ModuleId, PlatformUser } from '@/types';
import {
  seedAuditLog,
  seedClients,
  seedCredentialRefs,
  seedUsers,
} from '@/lib/data/demo/platform';
import {
  auditPayloadSchema,
  clientsPayloadSchema,
} from '@/lib/persistence/schema';
import { readStorage, STORAGE_KEYS, writeStorage } from '@/lib/persistence/storage';

export interface PlatformState {
  clients: Client[];
  users: PlatformUser[];
  auditLog: AuditLogEntry[];
  credentialRefs: CredentialRef[];
  currentUser: PlatformUser;
}

export interface AuditDraft {
  action: AuditAction;
  details: string;
  clientId?: string;
  clientName?: string;
  moduleId?: ModuleId;
}

export interface PlatformActions {
  setModuleEnabled: (clientId: string, moduleId: ModuleId, enabled: boolean) => void;
  setClientDataMode: (clientId: string, mode: 'demo' | 'live') => void;
  createClient: (input: Omit<Client, 'id' | 'createdAt' | 'lastActive' | 'integrations'>) => Client;
  /** The demo identity switcher. Not authentication; see DemoIdentitySwitcher. */
  setCurrentUser: (user: PlatformUser) => void;
  recordAudit: (draft: AuditDraft) => void;
}

const StateContext = createContext<PlatformState | undefined>(undefined);
const ActionsContext = createContext<PlatformActions | undefined>(undefined);

// The audit log is a reducer fed by an explicit dispatch, which makes it
// structurally impossible to append from inside a state updater. The
// prototype called its logging function inside setClients(prev => ...) at
// four call sites; StrictMode double-invokes updaters, so every module toggle
// wrote two entries in development and one in production, and the two audit
// trails disagreed by design.
type AuditEvent = { type: 'append'; entry: AuditLogEntry };

function auditReducer(state: AuditLogEntry[], event: AuditEvent): AuditLogEntry[] {
  switch (event.type) {
    case 'append':
      return [event.entry, ...state];
    default:
      return state;
  }
}

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [clients, setClients] = useState<Client[]>(
    () => readStorage(STORAGE_KEYS.clients, clientsPayloadSchema) ?? seedClients()
  );
  const [users] = useState<PlatformUser[]>(() => seedUsers());
  const [credentialRefs] = useState<CredentialRef[]>(() => seedCredentialRefs());
  const [auditLog, dispatchAudit] = useReducer(
    auditReducer,
    undefined,
    () => readStorage(STORAGE_KEYS.audit, auditPayloadSchema) ?? seedAuditLog()
  );

  // Not persisted. A simulated identity that survived a refresh would look
  // like a session, and this one is a presentation device.
  const [currentUser, setCurrentUserState] = useState<PlatformUser>(
    () => seedUsers()[0] as PlatformUser
  );

  const persistClients = useCallback((next: Client[]) => {
    writeStorage(STORAGE_KEYS.clients, next);
    return next;
  }, []);

  const recordAudit = useCallback(
    (draft: AuditDraft) => {
      const entry: AuditLogEntry = {
        id: nextId('aud'),
        timestamp: new Date().toISOString(),
        userId: currentUser.id,
        userName: currentUser.name,
        ...draft,
      };
      dispatchAudit({ type: 'append', entry });
      // Read back through the reducer would be stale here, so the write goes
      // through the same shape the reducer produces.
      writeStorage(STORAGE_KEYS.audit, [entry, ...auditLog]);
    },
    [currentUser.id, currentUser.name, auditLog]
  );

  const setModuleEnabled = useCallback(
    (clientId: string, moduleId: ModuleId, enabled: boolean) => {
      let target: Client | undefined;
      // The updater computes the next state and nothing else. Anything with a
      // side effect belongs after the setter returns.
      setClients((prev) => {
        const next = prev.map((client) => {
          if (client.id !== clientId) return client;
          target = client;
          const enabledModules = enabled
            ? [...new Set([...client.enabledModules, moduleId])]
            : client.enabledModules.filter((m) => m !== moduleId);
          return { ...client, enabledModules };
        });
        return persistClients(next);
      });
      if (target) {
        recordAudit({
          action: enabled ? 'ENABLE_MODULE' : 'DISABLE_MODULE',
          details: `${enabled ? 'Enabled' : 'Disabled'} ${moduleId.replace('_', ' ')}`,
          clientId,
          clientName: target.name,
          moduleId,
        });
      }
    },
    [persistClients, recordAudit]
  );

  const setClientDataMode = useCallback(
    (clientId: string, mode: 'demo' | 'live') => {
      let target: Client | undefined;
      setClients((prev) => {
        const next = prev.map((client) => {
          if (client.id !== clientId) return client;
          target = client;
          return {
            ...client,
            dataMode: mode,
            integrations: client.integrations.map((i) => ({ ...i, dataMode: mode })),
          };
        });
        return persistClients(next);
      });
      if (target) {
        recordAudit({
          action: 'SWITCH_DATA_MODE',
          details: `Data mode set to ${mode}`,
          clientId,
          clientName: target.name,
        });
      }
    },
    [persistClients, recordAudit]
  );

  const createClient = useCallback<PlatformActions['createClient']>(
    (input) => {
      const now = new Date().toISOString();
      const client: Client = {
        ...input,
        id: nextId('cl'),
        createdAt: now,
        lastActive: now,
        integrations: [],
      };
      setClients((prev) => persistClients([...prev, client]));
      recordAudit({
        action: 'CREATE_CLIENT',
        details: `Created workspace ${client.name}`,
        clientId: client.id,
        clientName: client.name,
      });
      return client;
    },
    [persistClients, recordAudit]
  );

  const setCurrentUser = useCallback((user: PlatformUser) => {
    setCurrentUserState(user);
  }, []);

  const state = useMemo<PlatformState>(
    () => ({ clients, users, auditLog, credentialRefs, currentUser }),
    [clients, users, auditLog, credentialRefs, currentUser]
  );

  const actions = useMemo<PlatformActions>(
    () => ({ setModuleEnabled, setClientDataMode, createClient, setCurrentUser, recordAudit }),
    [setModuleEnabled, setClientDataMode, createClient, setCurrentUser, recordAudit]
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
  return useMemo(
    () => clients.find((c) => c.id === clientId),
    [clients, clientId]
  );
}
