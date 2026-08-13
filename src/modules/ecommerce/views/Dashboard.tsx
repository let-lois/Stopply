import { useMemo } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { MiniAreaChart } from '@/components/charts/MiniAreaChart';
import { Card, Stat } from '@/components/ui';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function EcommerceDashboard() {
  const { data, mode, isLoading, error } = useModuleData('ecommerce');

  const totals = useMemo(() => {
    if (!data) return null;
    const revenue = data.orders.reduce((n, o) => n + o.total, 0);
    const fulfilled = data.orders.filter((o) => o.status === 'fulfilled').length;
    const refunded = data.orders.filter((o) => o.status === 'refunded').length;
    return {
      revenue,
      orders: data.orders.length,
      aov: data.orders.length > 0 ? revenue / data.orders.length : 0,
      fulfilled,
      refunded,
    };
  }, [data]);

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data}>
      {data && totals && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Revenue" value={money(totals.revenue)} accent="emerald" />
            <Stat label="Orders" value={totals.orders.toLocaleString()} accent="sky" />
            <Stat label="Average order" value={money(totals.aov)} accent="indigo" />
            <Stat
              label="Refunded"
              value={totals.refunded.toLocaleString()}
              note={`${totals.fulfilled} fulfilled`}
              accent={totals.refunded > 0 ? 'amber' : 'slate'}
            />
          </div>
          <Card>
            <p className="micro-label mb-4">Daily revenue, last 30 days</p>
            <MiniAreaChart
              data={data.revenueSeries.map((p) => ({ day: p.day, value: p.revenue }))}
              label="Revenue"
            />
          </Card>
        </div>
      )}
    </ModuleGate>
  );
}
