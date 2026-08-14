import { useMemo } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Card, Stat } from '@/components/ui';
import type { PipelineStage } from '@/modules/crm/types';

const STAGES: Array<{ id: PipelineStage; label: string }> = [
  { id: 'new', label: 'New' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function CrmPipeline() {
  const { data, mode, isLoading, error } = useModuleData('crm');

  const columns = useMemo(
    () =>
      STAGES.map((stage) => {
        const deals = (data?.deals ?? []).filter((d) => d.stage === stage.id);
        return { ...stage, deals, value: deals.reduce((n, d) => n + d.value, 0) };
      }),
    [data]
  );

  const open = useMemo(
    () => columns.filter((c) => c.id !== 'won' && c.id !== 'lost'),
    [columns]
  );

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data?.deals.length}>
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Open pipeline"
            value={money(open.reduce((n, c) => n + c.value, 0))}
            note={`${open.reduce((n, c) => n + c.deals.length, 0)} deals`}
            accent="indigo"
          />
          <Stat
            label="Won"
            value={money(columns.find((c) => c.id === 'won')?.value ?? 0)}
            accent="emerald"
          />
          <Stat
            label="Lost"
            value={money(columns.find((c) => c.id === 'lost')?.value ?? 0)}
            accent="slate"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {columns.map((column) => (
            <Card key={column.id}>
              <div className="flex items-baseline justify-between">
                <p className="micro-label">{column.label}</p>
                <span className="numeric-display text-sm">{column.deals.length}</span>
              </div>
              <p className="numeric-display mt-1 text-xl">{money(column.value)}</p>
              <ul className="mt-4 flex flex-col gap-2">
                {column.deals.slice(0, 5).map((deal) => (
                  <li
                    key={deal.id}
                    className="rounded-xl border border-[var(--color-hairline)] bg-fill-subtle p-3 text-sm"
                  >
                    <span className="block font-medium">{deal.company}</span>
                    <span className="text-xs text-[var(--color-ink-faint)]">
                      {deal.ownerName} · {money(deal.value)}
                    </span>
                  </li>
                ))}
                {column.deals.length > 5 && (
                  <li className="text-xs text-[var(--color-ink-faint)]">
                    and {column.deals.length - 5} more
                  </li>
                )}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </ModuleGate>
  );
}
