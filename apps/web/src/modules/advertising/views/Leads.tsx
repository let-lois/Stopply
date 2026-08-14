import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Badge, Card } from '@/components/ui';
import { relativeTime } from '@/lib/format/datetime';

const STAGE_ACCENT = {
  new: 'sky', contacted: 'indigo', qualified: 'amber', won: 'emerald', lost: 'slate',
} as const;

export default function AdvertisingLeads() {
  const { data, mode, isLoading, error } = useModuleData('advertising');

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data?.leads.length}>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="micro-label pb-3">Lead</th>
              <th className="micro-label pb-3">Stage</th>
              <th className="micro-label pb-3 text-right">Value</th>
              <th className="micro-label pb-3 text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {data?.leads.map((lead) => (
              <tr key={lead.id} className="border-t border-[var(--color-hairline)]">
                <td className="py-3 pr-4">
                  <span className="block">{lead.name}</span>
                  <span className="text-xs text-[var(--color-ink-faint)]">{lead.email}</span>
                </td>
                <td className="py-3 pr-4">
                  <Badge accent={STAGE_ACCENT[lead.stage]}>{lead.stage}</Badge>
                </td>
                <td className="numeric-display py-3 text-right">
                  ${lead.value.toLocaleString()}
                </td>
                <td className="py-3 text-right text-[var(--color-ink-soft)]">
                  {relativeTime(lead.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ModuleGate>
  );
}
