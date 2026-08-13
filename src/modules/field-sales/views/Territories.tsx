import { useMemo } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Card } from '@/components/ui';
import { selectTerritoryCoverage } from '@/modules/field-sales/selectors';

export default function FieldSalesTerritories() {
  const { data, mode, isLoading, error } = useModuleData('field_sales');

  const rows = useMemo(
    () =>
      data ? selectTerritoryCoverage(data.territories, data.properties, data.visits, data.reps) : [],
    [data]
  );

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={rows.length > 0}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((t) => (
          <Card key={t.territoryId}>
            <p className="micro-label">
              {t.assignedRepNames.length > 0 ? t.assignedRepNames.join(', ') : 'Unassigned'}
            </p>
            <h3 className="mt-1 text-lg font-semibold">{t.name}</h3>
            <p className="numeric-display mt-4 text-3xl">
              {Math.round(t.coveragePct * 100)}%
            </p>
            <p className="text-xs text-[var(--color-ink-faint)]">
              {t.visitedProperties.toLocaleString()} of {t.totalProperties.toLocaleString()} doors worked
            </p>
            <div
              className="mt-4 h-2 overflow-hidden rounded-full bg-white/8"
              role="presentation"
            >
              <div
                className="h-full rounded-full bg-[var(--color-accent-amber)]"
                style={{ width: `${t.coveragePct * 100}%` }}
              />
            </div>
          </Card>
        ))}
      </div>
    </ModuleGate>
  );
}
