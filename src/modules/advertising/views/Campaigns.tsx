import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Badge, Card } from '@/components/ui';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function AdvertisingCampaigns() {
  const { data, mode, isLoading, error } = useModuleData('advertising');

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data?.campaigns.length}>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="micro-label pb-3">Campaign</th>
              <th className="micro-label pb-3">Channel</th>
              <th className="micro-label pb-3">Status</th>
              <th className="micro-label pb-3 text-right">Spend</th>
              <th className="micro-label pb-3 text-right">Leads</th>
              <th className="micro-label pb-3 text-right">Cost / lead</th>
              <th className="micro-label pb-3 text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {data?.campaigns.map((c) => (
              <tr key={c.id} className="border-t border-[var(--color-hairline)]">
                <td className="py-3 pr-4">{c.name}</td>
                <td className="py-3 pr-4">
                  <Badge accent={c.channel === 'meta' ? 'purple' : 'sky'}>{c.channel}</Badge>
                </td>
                <td className="py-3 pr-4">
                  <Badge accent={c.status === 'active' ? 'emerald' : 'slate'}>{c.status}</Badge>
                </td>
                <td className="numeric-display py-3 text-right">{money(c.spend)}</td>
                <td className="numeric-display py-3 text-right">{c.leads}</td>
                <td className="numeric-display py-3 text-right">
                  {c.leads > 0 ? money(c.spend / c.leads) : '--'}
                </td>
                <td className="numeric-display py-3 text-right">
                  {(c.revenue / c.spend).toFixed(2)}x
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ModuleGate>
  );
}
