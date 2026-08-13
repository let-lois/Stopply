import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Badge, Button, Card } from '@/components/ui';
import { LogVisitDialog } from '@/modules/field-sales/components/LogVisitDialog';

import { DISPOSITION_LABELS } from '@/modules/field-sales/selectors';
import type { PropertyDisposition } from '@/modules/field-sales/types';
import { relativeTime } from '@/lib/format/datetime';
import {
  lastRepByProperty,
  repColors,
  UNWORKED_COLOR,
} from '@/modules/field-sales/repColors';
import type { Property } from '@/modules/field-sales/types';
import { Skeleton } from '@/components/ui';

// MapLibre is around 200KB gzipped, which is worth it here and worth nothing
// on the five views that do not draw a map. Canvass is already a lazy route,
// so this keeps the map out of even that chunk until the view renders.
const DoorMap = lazy(() =>
  import('@/modules/field-sales/components/DoorMap').then((m) => ({ default: m.DoorMap }))
);

// Outcome colours, as literals, because the map resolves a colour per door
// rather than reading a CSS variable on the GPU.
const DISPOSITION_HEX: Record<PropertyDisposition, string> = {
  not_visited: '#6b7280',
  no_answer: '#94a3b8',
  come_back: '#f59e0b',
  not_interested: '#ef4444',
  interested: '#38bdf8',
  appointment_set: '#a855f7',
  closed_sale: '#10b981',
  do_not_knock: '#f8fafc',
};


const FILTERS: Array<{ id: 'all' | PropertyDisposition; label: string }> = [
  { id: 'all', label: 'All doors' },
  { id: 'not_visited', label: 'Not visited' },
  { id: 'interested', label: 'Interested' },
  { id: 'appointment_set', label: 'Appointment set' },
  { id: 'closed_sale', label: 'Closed' },
  { id: 'do_not_knock', label: 'Do not knock' },
];

export default function FieldSalesCanvass() {
  const { data, mode, isLoading, error } = useModuleData('field_sales');
  const [filter, setFilter] = useState<'all' | PropertyDisposition>('all');
  // A rep canvasses one territory, not the whole city, and plotting every
  // territory into one box squeezes each into a tenth of the plot: pins then
  // overlap and one intercepts another's click, which is a door nobody can
  // tap. Defaulting to a single territory is both truer to the job and what
  // keeps the pins individually reachable. 'all' stays available as an
  // overview where density is expected.
  const [territoryId, setTerritoryId] = useState<string>('first');
  // The id, not the object. Holding a snapshot is what left the prototype's
  // detail panel showing a stale status after a visit was logged.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  // What the colours mean. Outcome answers "what happened at this house"; rep
  // answers "who is working this street", which is the question a manager
  // looking at a city has. Neither replaces the other.
  const [colorBy, setColorBy] = useState<'outcome' | 'rep'>('outcome');
  const [repFilter, setRepFilter] = useState<string>('all');

  // Memoized rather than defaulted inline: `?? []` builds a new array on
  // every render, which would invalidate every downstream useMemo below it.
  const properties = useMemo(() => data?.properties ?? [], [data]);

  const activeTerritoryId = useMemo(() => {
    if (territoryId !== 'first') return territoryId;
    return data?.territories[0]?.id ?? 'all';
  }, [territoryId, data]);

  const inTerritory = useMemo(
    () =>
      activeTerritoryId === 'all'
        ? properties
        : properties.filter((p) => p.territoryId === activeTerritoryId),
    [properties, activeTerritoryId]
  );

  // The map frames itself on the territory's own extent, never on the
  // filtered subset, so narrowing the filter cannot move the view. Undefined
  // for "all territories", where the map fits the doors instead.
  const activeTerritory = useMemo(
    () => data?.territories.find((t) => t.id === activeTerritoryId),
    [data, activeTerritoryId]
  );

  const reps = useMemo(() => data?.reps ?? [], [data]);
  const colorByRep = useMemo(() => repColors(reps), [reps]);

  // Who last knocked each door. The latest visit wins, so a door shows
  // whoever worked it most recently rather than whoever got there first.
  const repByProperty = useMemo(
    () => lastRepByProperty(data?.visits ?? []),
    [data]
  );

  const colorFor = useCallback(
    (property: Property) => {
      if (colorBy === 'outcome') return DISPOSITION_HEX[property.disposition];
      const repId = repByProperty.get(property.id);
      // Grey for a door nobody has knocked. It has no rep to be coloured by,
      // and inventing one would be the map claiming knowledge it does not have.
      return repId ? (colorByRep.get(repId) ?? UNWORKED_COLOR) : UNWORKED_COLOR;
    },
    [colorBy, repByProperty, colorByRep]
  );

  const visible = useMemo(() => {
    const byOutcome =
      filter === 'all' ? inTerritory : inTerritory.filter((p) => p.disposition === filter);
    if (repFilter === 'all') return byOutcome;
    // Narrowing to one rep is how a manager checks a single person's round
    // without reading every other pin on the street.
    return byOutcome.filter((p) => repByProperty.get(p.id) === repFilter);
  }, [inTerritory, filter, repFilter, repByProperty]);

  const selected = useMemo(
    () => properties.find((p) => p.id === selectedId) ?? null,
    [properties, selectedId]
  );

  // Stable, so the map's click handler does not have to be rebound and the
  // map never has to be torn down and rebuilt to pick up a new closure.
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  const lastVisit = useMemo(() => {
    if (!selected || !data) return null;
    return (
      data.visits
        .filter((v) => v.propertyId === selected.id)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0] ?? null
    );
  }, [selected, data]);

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={properties.length > 0}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              variant={filter === f.id ? 'primary' : 'secondary'}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
          <select
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value === 'rep' ? 'rep' : 'outcome')}
            aria-label="Colour doors by"
            className="ml-auto min-h-10 rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 text-sm"
          >
            <option value="outcome">Colour by outcome</option>
            <option value="rep">Colour by rep</option>
          </select>

          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            aria-label="Rep"
            className="min-h-10 rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 text-sm"
          >
            <option value="all">All reps</option>
            {reps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.name}
              </option>
            ))}
          </select>

          <select
            value={activeTerritoryId}
            onChange={(e) => setTerritoryId(e.target.value)}
            aria-label="Territory"
            className="min-h-10 rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 text-sm"
          >
            <option value="all">All territories</option>
            {data?.territories.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card className="relative flex min-h-[34rem] flex-col overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-3">
              <p className="micro-label">
                {visible.length.toLocaleString()} of {inTerritory.length.toLocaleString()} doors
              </p>
            </div>
            {/* A colour coding nobody can read is decoration. The legend is
                not optional, and it changes with what the colours mean. */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-6 pb-3 text-xs">
              {colorBy === 'rep'
                ? [
                    ...reps.map((rep) => ({
                      key: rep.id,
                      label: rep.name,
                      color: colorByRep.get(rep.id) ?? UNWORKED_COLOR,
                    })),
                    { key: 'none', label: 'Not yet knocked', color: UNWORKED_COLOR },
                  ].map((entry) => (
                    <span key={entry.key} className="flex items-center gap-1.5">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: entry.color }}
                        aria-hidden="true"
                      />
                      <span className="text-[var(--color-ink-soft)]">{entry.label}</span>
                    </span>
                  ))
                : FILTERS.filter((f) => f.id !== 'all').map((f) => (
                    <span key={f.id} className="flex items-center gap-1.5">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: DISPOSITION_HEX[f.id as PropertyDisposition] }}
                        aria-hidden="true"
                      />
                      <span className="text-[var(--color-ink-soft)]">{f.label}</span>
                    </span>
                  ))}
            </div>

            <div className="min-h-0 flex-1">
              <Suspense fallback={<Skeleton className="size-full" />}>
                <DoorMap
                  properties={visible}
                  territory={activeTerritory}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  colorFor={colorFor}
                />
              </Suspense>
            </div>
          </Card>

          <Card>
            {selected ? (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="micro-label">Door</p>
                  <p className="mt-1 font-semibold">{selected.address}</p>
                  <p className="text-sm text-[var(--color-ink-soft)]">
                    {selected.city}, {selected.state} {selected.postalCode}
                  </p>
                </div>
                <Badge accent={selected.disposition === 'closed_sale' ? 'emerald' : 'slate'}>
                  {DISPOSITION_LABELS[selected.disposition]}
                </Badge>
                {selected.ownerName && (
                  <p className="text-sm">
                    {selected.ownerName}
                    {selected.ownerPhone && (
                      <span className="block text-[var(--color-ink-faint)]">
                        {selected.ownerPhone}
                      </span>
                    )}
                  </p>
                )}
                <p className="text-xs text-[var(--color-ink-faint)]">
                  {lastVisit ? `Last knocked ${relativeTime(lastVisit.occurredAt)}` : 'Never knocked'}
                </p>
                <Button variant="primary" onClick={() => setLogging(true)}>
                  Log a knock
                </Button>
              </div>
            ) : (
              <div>
                <p className="micro-label">Door detail</p>
                <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                  Select a pin to see what the team already knows about that house.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Mounted only while open, and given the derived property rather than
          a snapshot, so the panel behind it shows the new outcome the moment
          the knock is saved. */}
      {logging && selected && (
        <LogVisitDialog
          property={selected}
          reps={data?.reps ?? []}
          open
          onClose={() => setLogging(false)}
        />
      )}
    </ModuleGate>
  );
}
