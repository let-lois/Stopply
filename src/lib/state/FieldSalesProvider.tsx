// Field-sales state, split from platform state by update frequency.
//
// This is the high-frequency half. Logging a knock changes it constantly,
// and the prototype's single context meant every such change re-rendered
// every consumer, including all mounted charts. Read state and actions are
// separate contexts here, so a component that only logs a visit does not
// re-render when the visit list changes.
//
// Properties and visits are the only mutable field state. Everything the
// dashboard shows is derived from them by the selectors, so there is nothing
// else to keep in step and nothing that can drift.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
// One named interface, imported deliberately rather than incidentally. This
// is the single sanctioned crossing between shared state and a module's
// domain, and everything else below is derived from it so the surface cannot
// widen without someone noticing.
import type { FieldSalesSlice } from '@/modules/field-sales/types';

type Property = FieldSalesSlice['properties'][number];
type Visit = FieldSalesSlice['visits'][number];
type PropertyDisposition = Visit['disposition'];
import { fieldSalesDemo } from '@/lib/data/demo/fieldSales';
import { propertiesByClientSchema, visitsByClientSchema } from '@/lib/persistence/schema';
import { readStorage, STORAGE_KEYS, writeStorage } from '@/lib/persistence/storage';
import { usePlatform, usePlatformActions } from '@/lib/state/PlatformProvider';
import { api } from '@/lib/api/client';
import { apiPaths } from '@/lib/api/paths';
import { logVisitResponseSchema } from '@/modules/field-sales/contracts';

type ByClient<T> = Record<string, T[]>;

export interface LogVisitInput {
  propertyId: string;
  disposition: PropertyDisposition;
  notes: string | null;
  repId: string;
}

export interface FieldSalesActions {
  /**
   * Record a knock.
   *
   * In demo mode this updates local state only. In live mode it posts to the
   * server, which owns the id, the arrival time and the audit entry, and
   * which answers a resend of an already recorded knock with a success so an
   * offline outbox can retry until it drains.
   */
  logVisit: (input: LogVisitInput) => void;
}

const SliceContext = createContext<FieldSalesSlice | undefined>(undefined);
const ActionsContext = createContext<FieldSalesActions | undefined>(undefined);

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function FieldSalesProvider({ children }: { children: React.ReactNode }) {
  const { clientId } = useParams<{ clientId: string }>();
  const { clients } = usePlatform();
  const { refresh } = usePlatformActions();

  // Demo and live are two different stores, and which one a knock goes to is
  // the workspace's own setting rather than anything this component decides.
  const isLive = clients.find((c) => c.id === clientId)?.dataMode === 'live';

  const [propertiesByClient, setPropertiesByClient] = useState<ByClient<Property>>(
    () => readStorage(STORAGE_KEYS.properties, propertiesByClientSchema) ?? {}
  );
  const [visitsByClient, setVisitsByClient] = useState<ByClient<Visit>>(
    () => readStorage(STORAGE_KEYS.visits, visitsByClientSchema) ?? {}
  );

  // Territories and reps are not editable in this build, so they come from
  // the seed every time rather than being stored and risking a stale copy.
  const seed = useMemo(
    () => (clientId ? fieldSalesDemo(clientId, new Date()) : null),
    [clientId]
  );

  // Stored work wins; the seed fills in for a workspace nobody has touched.
  // Nothing is written until something is actually logged, so an untouched
  // client stays on generated data and a refresh does not freeze it.
  const slice = useMemo<FieldSalesSlice>(() => {
    if (!clientId || !seed) {
      return { properties: [], visits: [], territories: [], reps: [] };
    }
    return {
      properties: propertiesByClient[clientId] ?? seed.properties,
      visits: visitsByClient[clientId] ?? seed.visits,
      territories: seed.territories,
      reps: seed.reps,
    };
  }, [clientId, seed, propertiesByClient, visitsByClient]);

  const logVisit = useCallback(
    (input: LogVisitInput) => {
      if (!clientId || !seed) return;

      if (isLive) {
        // The id is minted here, on the device, before the knock is sent.
        // That is the whole offline story: the server recognises a resend by
        // this id and answers success rather than an error, so an outbox can
        // retry until it drains. Never move this to the server.
        const deviceVisitId = `dev_${crypto.randomUUID()}`;

        void api
          .post(
            apiPaths.fieldSalesVisits(clientId),
            {
              deviceVisitId,
              propertyId: input.propertyId,
              repId: input.repId,
              disposition: input.disposition,
              notes: input.notes,
              // The clock at the door, not the clock on arrival. Reporting
              // reads this, so a knock uploaded late stays on the day it
              // happened.
              occurredAt: new Date().toISOString(),
            },
            logVisitResponseSchema
          )
          // The server owns the doors in live mode, so the way to see the
          // knock is to re-read them rather than to guess locally and hope
          // the guess matches what was recorded.
          .then(() => refresh());
        return;
      }

      const visit: Visit = {
        id: nextId('visit'),
        propertyId: input.propertyId,
        repId: input.repId,
        disposition: input.disposition,
        notes: input.notes,
        occurredAt: new Date().toISOString(),
      };

      // Both updaters are pure: they compute the next state and nothing else.
      // The prototype called its audit logger from inside setClients, and
      // StrictMode's double invocation then wrote two entries in development
      // and one in production.
      setVisitsByClient((prev) => {
        const current = prev[clientId] ?? seed.visits;
        const next = { ...prev, [clientId]: [...current, visit] };
        writeStorage(STORAGE_KEYS.visits, next);
        return next;
      });

      setPropertiesByClient((prev) => {
        const current = prev[clientId] ?? seed.properties;
        const next = {
          ...prev,
          [clientId]: current.map((property) =>
            property.id === input.propertyId
              ? { ...property, disposition: input.disposition }
              : property
          ),
        };
        writeStorage(STORAGE_KEYS.properties, next);
        return next;
      });

      // The trail is the server's. In live mode the POST below writes it; in
      // demo mode nothing is recorded, because nothing happened to anyone's
      // real workspace and an audit entry saying otherwise would be a lie.
      //
      // The prototype called its logger from inside setClients, which
      // StrictMode double-invokes, so development wrote two entries and
      // production one.
    },
    [clientId, seed, isLive, refresh]
  );

  const actions = useMemo<FieldSalesActions>(() => ({ logVisit }), [logVisit]);

  return (
    <SliceContext.Provider value={slice}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </SliceContext.Provider>
  );
}

/** Undefined outside a workspace route, which useModuleData relies on. */
export function useFieldSalesSlice(): FieldSalesSlice | undefined {
  return useContext(SliceContext);
}

export function useFieldSalesActions(): FieldSalesActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useFieldSalesActions must be used inside FieldSalesProvider');
  return value;
}
