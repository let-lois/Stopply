// The rep's session and their doors, in one place.
//
// Deliberately not PlatformProvider. The rep app shares no state with the
// dashboard, and giving it its own provider is what keeps a phone from ever
// holding a client's roster, audit trail or credential list in memory.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { api, ApiRequestError } from '@/lib/api/client';
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
}

export interface FieldActions {
  signIn: (email: string, password: string, turnstileToken: string) => Promise<void>;
  signOut: () => Promise<void>;
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
  });

  const apply = useCallback((data: FieldDoors) => {
    setState({ status: 'signed-in', data, error: null });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get(paths.doors, fieldDoorsSchema, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) apply(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: 'signed-out', data: null, error: null });
        }
      });
    return () => controller.abort();
  }, [apply]);

  const signIn = useCallback<FieldActions['signIn']>(
    async (email, password, turnstileToken) => {
      apply(await api.post(paths.login, { email, password, turnstileToken }, fieldDoorsSchema));
    },
    [apply]
  );

  const signOut = useCallback(async () => {
    try {
      await api.post(paths.logout, {}, okSchema);
    } catch (error) {
      // Signing out must not be blockable by a bad connection, which is the
      // normal condition for this app.
      if (!(error instanceof ApiRequestError)) throw error;
    }
    setState({ status: 'signed-out', data: null, error: null });
  }, []);

  const refresh = useCallback(async () => {
    apply(await api.get(paths.doors, fieldDoorsSchema));
  }, [apply]);

  const logKnock = useCallback<FieldActions['logKnock']>(
    async (input) => {
      // Minted here, on the device, before the knock is sent. The server
      // recognises a resend by this id and answers success, so the outbox in
      // the next change can retry forever without double counting a door.
      const deviceVisitId = `dev_${crypto.randomUUID()}`;

      const result = await api.post(
        paths.visits,
        {
          deviceVisitId,
          propertyId: input.propertyId,
          disposition: input.disposition,
          notes: input.notes,
          // The phone's clock at the door. A knock uploaded hours later still
          // belongs to the day it happened.
          occurredAt: new Date().toISOString(),
        },
        logVisitResponseSchema
      );

      // Applied locally rather than refetched. A rep on a weak signal should
      // see the door change the instant they tap, and the next refresh
      // reconciles against the server anyway.
      setState((prev) => {
        if (!prev.data) return prev;
        return {
          ...prev,
          data: {
            ...prev.data,
            properties: prev.data.properties.map((p) =>
              p.id === input.propertyId ? { ...p, disposition: input.disposition } : p
            ),
            visits: result.duplicate ? prev.data.visits : [result.visit, ...prev.data.visits],
          },
        };
      });
    },
    []
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
