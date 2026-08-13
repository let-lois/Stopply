// The data seam. Every module reads through this and nothing else.
//
// In the prototype five of six modules did `const data = demoAdvertisingData`
// at module scope. Two things followed: switching the active client changed
// nothing on screen, and the demo-to-live toggle was a no-op that still wrote
// an audit entry claiming the data source had changed. Only field-sales read
// through context, which is why it was the only module that behaved.
//
// The property that matters is that selecting live mode produces a visible,
// honest result. Continuing to show demo data behind a badge reading LIVE is
// the exact failure this replaces.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { DataMode, ModuleId } from '@/types';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { buildDemoData, type ModuleDataMap } from '@/lib/data/moduleDataMap';
import { resolveDataMode } from '@/lib/data/resolveDataMode';
import { fetchLiveData } from '@/lib/data/live';
import { LiveModeNotAvailableError } from '@/lib/data/errors';

export interface ModuleDataResult<M extends ModuleId> {
  data: ModuleDataMap[M] | undefined;
  mode: DataMode;
  isLoading: boolean;
  error: Error | null;
}

export function useModuleData<M extends ModuleId>(moduleId: M): ModuleDataResult<M> {
  // The URL is the single source of truth for which client is active. The
  // prototype kept an activeTab in component state and a currentClientId
  // beside it, which is the same class of defect this rebuild exists to
  // remove.
  const { clientId } = useParams<{ clientId: string }>();
  const { clients } = usePlatform();

  const client = useMemo(() => clients.find((c) => c.id === clientId), [clients, clientId]);
  const mode = useMemo(() => resolveDataMode(client, moduleId), [client, moduleId]);

  // Demo data is synchronous, so it is computed during render rather than
  // faked through a loading state that never means anything.
  const demoData = useMemo(
    () => (mode === 'demo' && clientId ? buildDemoData(moduleId, clientId, new Date()) : undefined),
    [mode, clientId, moduleId]
  );

  // Identifies the fetch the current render needs. Loading is then derived by
  // comparing it against what has actually arrived, rather than set
  // synchronously at the top of the effect, which would trigger a cascading
  // render on every change of client or module.
  const requestKey = mode === 'live' && clientId ? `${moduleId}:${clientId}` : null;

  const [liveResult, setLiveResult] = useState<{
    key: string;
    data: ModuleDataMap[M] | undefined;
    error: Error | null;
  } | null>(null);

  useEffect(() => {
    if (!requestKey || !clientId) return;

    let cancelled = false;
    fetchLiveData(moduleId, clientId)
      .then((data) => {
        if (!cancelled) setLiveResult({ key: requestKey, data, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const error = cause instanceof Error ? cause : new LiveModeNotAvailableError(moduleId);
        setLiveResult({ key: requestKey, data: undefined, error });
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey, clientId, moduleId]);

  if (mode === 'demo') {
    return { data: demoData, mode, isLoading: false, error: null };
  }

  // A result for a previous client or module is not this render's result.
  const settled = liveResult?.key === requestKey ? liveResult : null;
  return {
    data: settled?.data,
    mode,
    isLoading: settled === null,
    error: settled?.error ?? null,
  };
}
