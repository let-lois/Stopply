import { useMemo } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Badge, Card, Stat } from '@/components/ui';
import { relativeTime } from '@/lib/format/datetime';

const STATUS_LABEL = {
  label_created: 'Label created', in_transit: 'In transit',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', exception: 'Exception',
} as const;

const STATUS_ACCENT = {
  label_created: 'slate', in_transit: 'sky', out_for_delivery: 'indigo',
  delivered: 'emerald', exception: 'rose',
} as const;

export default function LogisticsDashboard() {
  const { data, mode, isLoading, error } = useModuleData('logistics');

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      total: data.shipments.length,
      inTransit: data.shipments.filter((s) => s.status === 'in_transit').length,
      delivered: data.shipments.filter((s) => s.status === 'delivered').length,
      exceptions: data.shipments.filter((s) => s.status === 'exception').length,
    };
  }, [data]);

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data}>
      {data && totals && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Shipments" value={totals.total.toLocaleString()} accent="indigo" />
            <Stat label="In transit" value={totals.inTransit.toLocaleString()} accent="sky" />
            <Stat label="Delivered" value={totals.delivered.toLocaleString()} accent="emerald" />
            <Stat
              label="Exceptions"
              value={totals.exceptions.toLocaleString()}
              accent={totals.exceptions > 0 ? 'rose' : 'slate'}
            />
          </div>
          <Card className="overflow-x-auto">
            <p className="micro-label mb-4">Shipments</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="micro-label pb-3">Reference</th>
                  <th className="micro-label pb-3">Carrier</th>
                  <th className="micro-label pb-3">Route</th>
                  <th className="micro-label pb-3">Status</th>
                  <th className="micro-label pb-3 text-right">Expected</th>
                </tr>
              </thead>
              <tbody>
                {data.shipments.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--color-hairline)]">
                    <td className="numeric-display py-3 pr-4">{s.reference}</td>
                    <td className="py-3 pr-4">{s.carrier}</td>
                    <td className="py-3 pr-4 text-[var(--color-ink-soft)]">
                      {s.origin} to {s.destination}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge accent={STATUS_ACCENT[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                    </td>
                    <td className="py-3 text-right text-[var(--color-ink-soft)]">
                      {relativeTime(s.expectedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </ModuleGate>
  );
}
