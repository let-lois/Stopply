// The rep's day: what is near me, and what happened at each of them.
//
// The list is ordered by distance when there is a fix, because the question a
// rep is actually asking is "which house next", not "which house
// alphabetically". Without a fix it falls back to address order and says so,
// rather than pretending to an order it cannot compute.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, MapPin, RefreshCw } from 'lucide-react';
import { useField, useFieldActions, type Door } from '@/lib/field/FieldSessionProvider';
import { distanceM, formatDistance, getFix, type Fix, type GeoState } from '@/lib/field/geo';
import { DISPOSITION_LABELS } from '@/modules/field-sales/selectors';
import { KnockSheet } from '@/field/KnockSheet';

// Bright enough to read on a screen angled at the sky. The dashboard's
// muted variants of these wash out completely outdoors.
const OUTCOME_DOT: Record<Door['disposition'], string> = {
  not_visited: 'bg-[var(--color-ink-faint)]',
  no_answer: 'bg-[var(--color-accent-slate)]',
  come_back: 'bg-[var(--color-accent-amber)]',
  not_interested: 'bg-[var(--color-negative)]',
  interested: 'bg-[var(--color-accent-sky)]',
  appointment_set: 'bg-[var(--color-accent-purple)]',
  closed_sale: 'bg-[var(--color-positive)]',
  do_not_knock: 'bg-[var(--color-ink)]',
};

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function FieldToday() {
  const { data } = useField();
  const { signOut, refresh } = useFieldActions();
  // Starts as 'locating' rather than 'idle' because the app always asks on
  // arrival. Setting it from inside the effect instead would be a synchronous
  // setState in an effect body, which cascades a render on every mount.
  const [geo, setGeo] = useState<GeoState>({ status: 'locating' });
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const runFix = useCallback(() => {
    getFix()
      .then((fix: Fix) => setGeo({ status: 'ready', fix }))
      .catch((error: unknown) =>
        setGeo({ status: String(error).includes('denied') ? 'denied' : 'unavailable' })
      );
  }, []);

  // Asked for once on arrival. A rep opening the app is about to knock, so
  // making them tap a button first is a step for nothing. Only the async
  // callbacks set state; the effect body does not.
  useEffect(() => {
    runFix();
  }, [runFix]);

  // Retry, from a tap rather than from an effect.
  const locate = useCallback(() => {
    setGeo({ status: 'locating' });
    runFix();
  }, [runFix]);

  const doors = useMemo(() => data?.properties ?? [], [data]);

  const ordered = useMemo(() => {
    if (geo.status !== 'ready') {
      return doors.map((door) => ({ door, metres: null as number | null }));
    }
    return doors
      .map((door) => ({ door, metres: distanceM(geo.fix, door) }))
      .sort((a, b) => a.metres - b.metres);
  }, [doors, geo]);

  const knockedToday = useMemo(() => {
    const since = startOfToday();
    return (data?.visits ?? []).filter((v) => new Date(v.occurredAt).getTime() >= since).length;
  }, [data]);

  const selectedDoor = useMemo(
    () => doors.find((d) => d.id === selected) ?? null,
    [doors, selected]
  );

  const onRefresh = () => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  };

  if (!data) return null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--color-hairline)] bg-[var(--color-surface-base)]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{data.session.repName}</p>
            <p className="truncate text-sm text-[var(--color-ink-soft)]">
              {data.session.territoryName ?? data.session.clientName}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Refresh doors"
              className="grid size-12 place-items-center rounded-2xl border border-[var(--color-hairline)]"
            >
              <RefreshCw size={20} className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              className="grid size-12 place-items-center rounded-2xl border border-[var(--color-hairline)]"
            >
              <LogOut size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4 text-sm">
          <span>
            <span className="text-lg font-bold tabular-nums">{knockedToday}</span>{' '}
            <span className="text-[var(--color-ink-soft)]">knocked today</span>
          </span>
          <span className="text-[var(--color-ink-soft)]">{doors.length} doors</span>
        </div>
      </header>

      {geo.status !== 'ready' && (
        <button
          type="button"
          onClick={locate}
          className="mx-4 mt-3 flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--color-hairline)] px-4 text-left"
        >
          <MapPin size={20} aria-hidden="true" />
          <span className="text-sm">
            {geo.status === 'locating' && 'Finding you…'}
            {/* Honest about what is lost, and still usable. Sorting silently
                by address while implying distance would be worse. */}
            {geo.status === 'denied' && 'Location is off, so doors are listed by address. Tap to retry.'}
            {geo.status === 'unavailable' && 'No location fix, so doors are listed by address. Tap to retry.'}
          </span>
        </button>
      )}

      <ul className="flex flex-1 flex-col gap-2 p-4">
        {ordered.map(({ door, metres }) => (
          <li key={door.id}>
            <button
              type="button"
              onClick={() => setSelected(door.id)}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-4 py-3 text-left active:brightness-125"
            >
              <span className={`size-3.5 shrink-0 rounded-full ${OUTCOME_DOT[door.disposition]}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold">{door.address}</span>
                <span className="block truncate text-sm text-[var(--color-ink-soft)]">
                  {DISPOSITION_LABELS[door.disposition]}
                </span>
              </span>
              {metres !== null && (
                <span className="shrink-0 text-sm font-medium tabular-nums text-[var(--color-ink-soft)]">
                  {formatDistance(metres)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {selectedDoor && (
        <KnockSheet door={selectedDoor} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
