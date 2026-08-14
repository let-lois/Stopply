import { useMemo } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { MiniAreaChart } from '@/components/charts/MiniAreaChart';
import { Card, Stat } from '@/components/ui';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function AdvertisingDashboard() {
  const { data, mode, isLoading, error } = useModuleData('advertising');

  const totals = useMemo(() => {
    if (!data) return null;
    const spend = data.campaigns.reduce((n, c) => n + c.spend, 0);
    const revenue = data.campaigns.reduce((n, c) => n + c.revenue, 0);
    const leads = data.campaigns.reduce((n, c) => n + c.leads, 0);
    return { spend, revenue, leads, roas: spend > 0 ? revenue / spend : 0 };
  }, [data]);

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data}>
      {data && totals && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Spend" value={money(totals.spend)} accent="amber" />
            <Stat label="Leads" value={totals.leads.toLocaleString()} accent="indigo" />
            <Stat label="Revenue" value={money(totals.revenue)} accent="emerald" />
            <Stat
              label="ROAS"
              value={`${totals.roas.toFixed(2)}x`}
              note={totals.roas >= 1 ? 'above break-even' : 'below break-even'}
              accent={totals.roas >= 1 ? 'emerald' : 'rose'}
            />
          </div>

          <Card>
            <p className="micro-label mb-4">Daily spend, last 30 days</p>
            <MiniAreaChart
              data={data.spendSeries.map((p) => ({ day: p.day, value: p.spend }))}
              label="Spend"
            />
          </Card>
        </div>
      )}
    </ModuleGate>
  );
}
