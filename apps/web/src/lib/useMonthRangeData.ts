'use client';

// Fetches one MonthData payload per month in a master date range and
// hands back the raw per-month array. Callers merge it (mergeMonthData)
// for display, or mutate it in place after an edit so the merged view
// updates without a refetch.

import { useEffect, useState } from 'react';
import { api } from './api';
import type { MonthData } from './types';

export function useMonthRangeData(monthsToFetch: string[], basis: 'first' | 'latest' = 'first') {
  const [raw, setRaw] = useState<MonthData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const key = monthsToFetch.join(',');

  useEffect(() => {
    if (monthsToFetch.length === 0) {
      setRaw([]);
      setError(null);
      return;
    }
    let alive = true;
    setError(null);
    setRaw([]);
    Promise.all(monthsToFetch.map((m) => api<MonthData>(`/api/tenant/months/${m}?basis=${basis}`)))
      .then((results) => {
        if (alive) setRaw(results);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'load failed');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, basis]);

  return { raw, setRaw, error };
}
