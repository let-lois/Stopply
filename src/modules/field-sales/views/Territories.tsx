// Carving the map up, and handing the pieces to reps.
//
// The two things a manager actually does here are draw a boundary and say who
// works it. Everything else on the page exists to tell them whether they got
// it right: how many doors landed in each patch, and how much of each has been
// worked.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { z } from 'zod';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Button, Card } from '@/components/ui';
import { selectTerritoryCoverage } from '@/modules/field-sales/selectors';
import { territoriesResponseSchema } from '@/modules/field-sales/contracts';
import type { Ring } from '@/modules/field-sales/polygon';
import { isUsableRing } from '@/modules/field-sales/polygon';
import { api, ApiRequestError } from '@/lib/api/client';
import { apiPaths } from '@/lib/api/paths';
import { useCan } from '@/lib/auth/useCan';

const TerritoryMap = lazy(() =>
  import('@/modules/field-sales/components/TerritoryMap').then((m) => ({ default: m.TerritoryMap }))
);

type TerritoriesResponse = z.infer<typeof territoriesResponseSchema>;

export default function FieldSalesTerritories() {
  const { data, mode, isLoading, error } = useModuleData('field_sales');
  const reps = useMemo(() => data?.reps ?? [], [data]);
  const { clientId } = useParams<{ clientId: string }>();
  const can = useCan();
  const mayEdit = can('client.configure', clientId ? { clientId } : undefined);

  // The server's own view, which carries the shapes and the door counts. The
  // module seam serves the reporting shape; this is the editing shape, and
  // conflating them would put every polygon in every dashboard fetch.
  const [server, setServer] = useState<TerritoriesResponse | null>(null);
  const [draft, setDraft] = useState<Ring | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [redrawingId, setRedrawingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();

    // Only the async callback sets state; the effect body does not, which is
    // what keeps this out of the render cascade.
    api
      .get(apiPaths.territories(clientId), territoriesResponseSchema, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setServer(next);
      })
      .catch(() => {
        // A viewer without permission simply gets no editing surface. The
        // coverage cards below still render from the module seam.
      });

    return () => controller.abort();
  }, [clientId]);

  // Coverage is computed from the module seam, which is the reporting read and
  // does not refetch when a territory is saved.
  const coverage = useMemo(
    () =>
      data ? selectTerritoryCoverage(data.territories, data.properties, data.visits, data.reps) : [],
    [data]
  );
  const coverageById = useMemo(
    () => new Map(coverage.map((c) => [c.territoryId, c])),
    [coverage]
  );

  /**
   * The cards are driven by the server's list, not by the seam's.
   *
   * Drawing a territory used to put it on the map with no card beside it, and
   * left the neighbouring cards quoting door counts from before the redraw:
   * the map came from the editing read and the cards from the reporting one,
   * so half the page was a version behind. The list and the counts now come
   * from the same response the map does, and only the worked-percentage is
   * looked up from the seam, defaulting to nothing for a territory too new to
   * have been reported on.
   */
  const cards = useMemo(
    () =>
      (server?.territories ?? []).map((t) => {
        const seam = coverageById.get(t.id);
        return {
          id: t.id,
          name: t.name,
          doors: server?.doorCounts[t.id] ?? 0,
          worked: seam?.visitedProperties ?? 0,
          repNames: t.repIds
            .map((id) => reps.find((r) => r.id === id)?.name)
            .filter((n): n is string => Boolean(n)),
        };
      }),
    [server, coverageById, reps]
  );

  const mapTerritories = useMemo(
    () => server?.territories.map((t) => ({ id: t.id, name: t.name, boundary: t.boundary })) ?? [],
    [server]
  );

  const addPoint = useCallback((point: [number, number]) => {
    setDraft((prev) => [...(prev ?? []), point]);
  }, []);

  const startDrawing = (territoryId: string | null) => {
    setRedrawingId(territoryId);
    setName(territoryId ? (server?.territories.find((t) => t.id === territoryId)?.name ?? '') : '');
    setDraft([]);
    setProblem(null);
  };

  const cancelDrawing = () => {
    setDraft(null);
    setRedrawingId(null);
    setName('');
    setProblem(null);
  };

  const save = async () => {
    if (!clientId || !draft) return;
    if (!isUsableRing(draft)) {
      setProblem('Tap at least three points on the map to enclose an area.');
      return;
    }
    if (!name.trim()) {
      setProblem('Give the territory a name.');
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      const body = { name: name.trim(), boundary: draft };
      const next = redrawingId
        ? await api.patch(apiPaths.territory(clientId, redrawingId), body, territoriesResponseSchema)
        : await api.post(apiPaths.territories(clientId), body, territoriesResponseSchema);
      setServer(next);
      cancelDrawing();
    } catch (cause) {
      setProblem(cause instanceof ApiRequestError ? cause.message : 'Could not save the territory.');
    } finally {
      setBusy(false);
    }
  };

  const assign = async (repId: string, territoryId: string | null) => {
    if (!clientId) return;
    setBusy(true);
    setProblem(null);
    try {
      setServer(
        await api.patch(apiPaths.rep(clientId, repId), { territoryId }, territoriesResponseSchema)
      );
    } catch (cause) {
      setProblem(cause instanceof ApiRequestError ? cause.message : 'Could not assign the rep.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (territoryId: string) => {
    if (!clientId) return;
    setBusy(true);
    setProblem(null);
    try {
      setServer(
        await api.delete(apiPaths.territory(clientId, territoryId), territoriesResponseSchema)
      );
    } catch (cause) {
      // The server refuses to delete a territory that still holds doors and
      // says how many. Surfaced verbatim: that is the useful sentence.
      setProblem(cause instanceof ApiRequestError ? cause.message : 'Could not remove the territory.');
    } finally {
      setBusy(false);
    }
  };


  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={cards.length > 0 || coverage.length > 0}>
      <div className="flex flex-col gap-4">
        {mayEdit && (
          <div className="flex flex-wrap items-center gap-3">
            {draft === null ? (
              <Button variant="primary" onClick={() => startDrawing(null)}>
                <Plus size={16} aria-hidden="true" />
                Draw a territory
              </Button>
            ) : (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Territory name"
                  aria-label="Territory name"
                  className="min-h-10 rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 text-sm"
                />
                <span className="text-sm text-[var(--color-ink-soft)]">
                  {draft.length === 0
                    ? 'Tap the map to place the first corner'
                    : `${draft.length} ${draft.length === 1 ? 'point' : 'points'}`}
                </span>
                <Button
                  onClick={() =>
                    setDraft((prev) => (prev && prev.length > 0 ? prev.slice(0, -1) : prev))
                  }
                  disabled={draft.length === 0}
                >
                  <Undo2 size={16} aria-hidden="true" />
                  Undo point
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void save()}
                  disabled={busy || draft.length < 3}
                >
                  {busy ? 'Saving' : redrawingId ? 'Save new shape' : 'Save territory'}
                </Button>
                <Button onClick={cancelDrawing} disabled={busy}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        )}

        {problem && (
          <p role="alert" className="text-sm text-[var(--color-accent-rose)]">
            {problem}
          </p>
        )}

        <Card className="h-[28rem] overflow-hidden p-0">
          <Suspense fallback={<div className="size-full" />}>
            <TerritoryMap
              territories={mapTerritories}
              draft={draft}
              selectedId={selectedId}
              onSelect={setSelectedId}
              {...(draft !== null ? { onAddPoint: addPoint } : {})}
            />
          </Suspense>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((t) => {
            const pct = t.doors > 0 ? t.worked / t.doors : 0;
            return (
              <Card key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className="block w-full text-left"
                >
                  <p className="micro-label">
                    {t.repNames.length > 0 ? t.repNames.join(', ') : 'Unassigned'}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">{t.name}</h3>
                  <p className="numeric-display mt-4 text-3xl">{Math.round(pct * 100)}%</p>
                  <p className="text-xs text-[var(--color-ink-faint)]">
                    {t.worked.toLocaleString()} of {t.doors.toLocaleString()} doors worked
                  </p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8" role="presentation">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent-amber)]"
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                </button>

                {mayEdit && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-hairline)] pt-3">
                    <Button onClick={() => startDrawing(t.id)} disabled={busy || draft !== null}>
                      <Pencil size={14} aria-hidden="true" />
                      Redraw
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => void remove(t.id)}
                      disabled={busy || draft !== null}
                      aria-label={`Remove ${t.name}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {mayEdit && reps.length > 0 && (
          <Card>
            <p className="micro-label">Who works where</p>
            <ul className="mt-3 flex flex-col gap-2">
              {reps.map((rep) => (
                <li key={rep.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-medium">{rep.name}</span>
                  <select
                    // From the server's list, not from the seam's copy of the
                    // rep. Reading rep.territoryId here left the dropdown a
                    // version behind the card beside it right after an
                    // assignment, which is the same staleness the cards had.
                    value={server?.territories.find((t) => t.repIds.includes(rep.id))?.id ?? ''}
                    disabled={busy}
                    aria-label={`Territory for ${rep.name}`}
                    onChange={(e) => void assign(rep.id, e.target.value || null)}
                    className="min-h-10 rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 text-sm"
                  >
                    {/* A rep with no territory sees their whole client's doors
                        rather than none, so this is a real choice and not an
                        empty state. */}
                    <option value="">No territory</option>
                    {(server?.territories ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </ModuleGate>
  );
}
