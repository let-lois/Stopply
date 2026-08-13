import { useMemo } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { MiniAreaChart } from '@/components/charts/MiniAreaChart';
import { Card, Stat } from '@/components/ui';

export default function AnalyticsOverview() {
  const { data, mode, isLoading, error } = useModuleData('analytics');

  const totals = useMemo(() => {
    if (!data) return null;
    const sessions = data.series.reduce((n, p) => n + p.sessions, 0);
    const conversions = data.series.reduce((n, p) => n + p.conversions, 0);
    const revenue = data.series.reduce((n, p) => n + p.revenue, 0);
    return { sessions, conversions, revenue, rate: sessions > 0 ? conversions / sessions : 0 };
  }, [data]);

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data}>
      {data && totals && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Sessions" value={totals.sessions.toLocaleString()} accent="sky" />
            <Stat label="Conversions" value={totals.conversions.toLocaleString()} accent="rose" />
            <Stat
              label="Conversion rate"
              value={`${(totals.rate * 100).toFixed(2)}%`}
              accent="indigo"
            />
            <Stat
              label="Revenue"
              value={`$${Math.round(totals.revenue).toLocaleString()}`}
              accent="emerald"
            />
          </div>

          <Card>
            <p className="micro-label mb-4">Sessions, last 30 days</p>
            <MiniAreaChart
              data={data.series.map((p) => ({ day: p.day, value: p.sessions }))}
              label="Sessions"
            />
          </Card>

          <Card>
            <p className="micro-label mb-4">Sources</p>
            <ul className="flex flex-col gap-3">
              {data.sources.map((source) => {
                const share = totals.sessions > 0 ? source.sessions / totals.sessions : 0;
                return (
                  <li key={source.name}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{source.name}</span>
                      <span className="numeric-display">{source.sessions.toLocaleString()}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill">
                      <div
                        className="h-full rounded-full bg-[var(--color-accent-rose)]"
                        style={{ width: `${share * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </ModuleGate>
  );
}
