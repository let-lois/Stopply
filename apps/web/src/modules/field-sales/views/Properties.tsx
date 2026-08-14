import { useMemo, useState } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Badge, Button, Card } from '@/components/ui';
import { DISPOSITION_LABELS } from '@/modules/field-sales/selectors';
import { LogVisitDialog } from '@/modules/field-sales/components/LogVisitDialog';

export default function FieldSalesProperties() {
  const { data, mode, isLoading, error } = useModuleData('field_sales');
  const [query, setQuery] = useState('');
  // The id, not the row, so the dialog and the table agree after a knock is
  // saved rather than the dialog holding a snapshot taken when it opened.
  const [loggingId, setLoggingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = data?.properties ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all.slice(0, 200);
    return all
      .filter((p) => `${p.address} ${p.ownerName ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 200);
  }, [data, query]);

  // Knocking from the list, not only from the map.
  //
  // The canvass is a canvas, so it has no elements a screen reader or a
  // keyboard can reach, and a door is a few pixels wide even for someone
  // using a mouse. This table is the same doors in a form anyone can work
  // with, and until now it was a dead end: you could find the house and then
  // had to go and hunt for its dot to record anything.
  const logging = useMemo(
    () => data?.properties.find((p) => p.id === loggingId) ?? null,
    [data, loggingId]
  );

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data?.properties.length}>
      <div className="flex flex-col gap-4">
        <label className="micro-label">
          Search
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Address or owner"
            className="mt-2 block w-full max-w-sm rounded-xl border border-[var(--color-hairline)] bg-fill-subtle px-3 py-2 text-sm normal-case tracking-normal text-[var(--color-ink)]"
          />
        </label>

        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="micro-label pb-3">Address</th>
                <th className="micro-label pb-3">Owner</th>
                <th className="micro-label pb-3">Outcome</th>
                <th className="micro-label pb-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-[var(--color-hairline)]">
                  <td className="py-3 pr-4">{p.address}</td>
                  <td className="py-3 pr-4 text-[var(--color-ink-soft)]">{p.ownerName ?? '--'}</td>
                  <td className="py-3">
                    <Badge accent={p.disposition === 'closed_sale' ? 'emerald' : 'slate'}>
                      {DISPOSITION_LABELS[p.disposition]}
                    </Badge>
                  </td>
                  <td className="py-3 pl-4 text-right">
                    <Button onClick={() => setLoggingId(p.id)} aria-label={`Log a knock at ${p.address}`}>
                      Log a knock
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 200 && (
            <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
              Showing the first 200 matches. Narrow the search to see more.
            </p>
          )}
        </Card>
      </div>

      {logging && (
        <LogVisitDialog
          property={logging}
          reps={data?.reps ?? []}
          open
          onClose={() => setLoggingId(null)}
        />
      )}
    </ModuleGate>
  );
}
