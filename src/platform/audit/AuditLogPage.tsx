import { usePlatform } from '@/lib/state/PlatformProvider';
import { Badge, Card, EmptyState } from '@/components/ui';
import { dateTime } from '@/lib/format/datetime';
import type { AuditAction } from '@/types';

// Branching on a closed union rather than substring-matching a free string,
// which is what the prototype did with log.action.includes('ENABLE').
const ACTION_ACCENT: Record<AuditAction, 'emerald' | 'rose' | 'indigo' | 'amber' | 'slate'> = {
  CREATE_CLIENT: 'indigo',
  UPDATE_CLIENT: 'slate',
  ENABLE_MODULE: 'emerald',
  DISABLE_MODULE: 'rose',
  SWITCH_DATA_MODE: 'amber',
  INTEGRATION_DATA_MODE: 'amber',
  LOG_VISIT: 'slate',
  ADD_PROPERTY: 'slate',
  ADD_CREDENTIAL: 'indigo',
  REMOVE_CREDENTIAL: 'rose',
};

export default function AuditLogPage() {
  const { auditLog } = usePlatform();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform activity</h1>
        {/* Not "complete immutable record": it is held in the browser and
            kept only for this build. Saying otherwise would be a claim the
            software cannot honour. */}
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          Actions taken in this browser, kept locally. It becomes a record of what
          happened across the platform once the backend stores it.
        </p>
      </div>

      {auditLog.length === 0 ? (
        <EmptyState title="Nothing recorded yet" body="Actions you take will appear here." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="micro-label pb-3">When</th>
                <th className="micro-label pb-3">Who</th>
                <th className="micro-label pb-3">Action</th>
                <th className="micro-label pb-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((entry) => (
                <tr key={entry.id} className="border-t border-[var(--color-hairline)]">
                  <td className="py-3 pr-4 whitespace-nowrap text-[var(--color-ink-soft)]">
                    {dateTime(entry.timestamp)}
                  </td>
                  <td className="py-3 pr-4">{entry.userName}</td>
                  <td className="py-3 pr-4">
                    <Badge accent={ACTION_ACCENT[entry.action]}>
                      {entry.action.replace(/_/g, ' ').toLowerCase()}
                    </Badge>
                  </td>
                  <td className="py-3 text-[var(--color-ink-soft)]">
                    {entry.details}
                    {entry.clientName && (
                      <span className="block text-xs text-[var(--color-ink-faint)]">
                        {entry.clientName}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
