import { useMemo, useState } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Badge, Button, Card } from '@/components/ui';
import { boundsFor, projectToBounds } from '@/modules/field-sales/geo';
import { DISPOSITION_LABELS } from '@/modules/field-sales/selectors';
import type { PropertyDisposition } from '@/modules/field-sales/types';
import { relativeTime } from '@/lib/format/datetime';

const DISPOSITION_COLOR: Record<PropertyDisposition, string> = {
  not_visited: 'var(--color-ink-faint)',
  no_answer: 'var(--color-accent-slate)',
  come_back: 'var(--color-accent-amber)',
  not_interested: 'var(--color-negative)',
  interested: 'var(--color-accent-sky)',
  appointment_set: 'var(--color-accent-purple)',
  closed_sale: 'var(--color-positive)',
  do_not_knock: 'var(--color-ink)',
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
  const [territoryId, setTerritoryId] = useState<string>('all');
  // The id, not the object. Holding a snapshot is what left the prototype's
  // detail panel showing a stale status after a visit was logged.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Memoized rather than defaulted inline: `?? []` builds a new array on
  // every render, which would invalidate every downstream useMemo below it.
  const properties = useMemo(() => data?.properties ?? [], [data]);

  const inTerritory = useMemo(
    () => (territoryId === 'all' ? properties : properties.filter((p) => p.territoryId === territoryId)),
    [properties, territoryId]
  );

  // The projection is built from the territory's full extent, never from the
  // filtered subset, so narrowing the filter cannot move a pin.
  const bounds = useMemo(() => boundsFor(inTerritory), [inTerritory]);

  const visible = useMemo(
    () => (filter === 'all' ? inTerritory : inTerritory.filter((p) => p.disposition === filter)),
    [inTerritory, filter]
  );

  const selected = useMemo(
    () => properties.find((p) => p.id === selectedId) ?? null,
    [properties, selectedId]
  );

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
            value={territoryId}
            onChange={(e) => setTerritoryId(e.target.value)}
            aria-label="Territory"
            className="ml-auto min-h-10 rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 text-sm"
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
          <Card className="relative min-h-[26rem] overflow-hidden">
            <p className="micro-label">
              {visible.length.toLocaleString()} of {inTerritory.length.toLocaleString()} doors
            </p>
            <div className="absolute inset-6 top-14">
              {visible.map((p) => {
                const { xPct, yPct } = projectToBounds(p, bounds);
                return (
                  <button
                    // Keyed by id, never by index, so React never reuses one
                    // house's node for another when the filter changes.
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    aria-label={`${p.address}, ${DISPOSITION_LABELS[p.disposition]}`}
                    aria-pressed={selectedId === p.id}
                    className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/40 transition-transform hover:scale-150"
                    style={{
                      left: `${xPct}%`,
                      top: `${yPct}%`,
                      background: DISPOSITION_COLOR[p.disposition],
                      outline: selectedId === p.id ? '2px solid var(--color-ink)' : undefined,
                      outlineOffset: 2,
                    }}
                  />
                );
              })}
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
    </ModuleGate>
  );
}
