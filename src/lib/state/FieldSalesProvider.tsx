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
import { usePlatformActions } from '@/lib/state/PlatformProvider';

type ByClient<T> = Record<string, T[]>;

export interface LogVisitInput {
  propertyId: string;
  disposition: PropertyDisposition;
  notes: string | null;
  repId: string;
}

export interface FieldSalesActions {
  logVisit: (input: LogVisitInput) => void;
}

const SliceContext = createContext<FieldSalesSlice | undefined>(undefined);
const ActionsContext = createContext<FieldSalesActions | undefined>(undefined);

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function FieldSalesProvider({ children }: { children: React.ReactNode }) {
  const { clientId } = useParams<{ clientId: string }>();
  const { recordAudit } = usePlatformActions();

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

      // Emitted after the setters return, in the action body. This is the
      // only place it can go and still produce exactly one entry.
      recordAudit({
        action: 'LOG_VISIT',
        details: `Logged ${input.disposition.replace(/_/g, ' ')}`,
        clientId,
        moduleId: 'field_sales',
      });
    },
    [clientId, seed, recordAudit]
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
