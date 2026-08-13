import { useMemo } from 'react';
import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Card, Stat } from '@/components/ui';
import {
  selectDispositionBreakdown,
  selectKpis,
  selectRepPerformance,
} from '@/modules/field-sales/selectors';
import { accentClasses } from '@/types/accent';
import { DISPOSITION_HEX } from '@/modules/field-sales/dispositionColors';

const pct = (n: number) => `${Math.round(n * 100)}%`;

// The map's colours, not a second set that has to be kept in step with them.
// This was a Record<string, string> of CSS variables, which meant a new
// outcome compiled cleanly and rendered as undefined in the chart.
const DISPOSITION_COLOR = DISPOSITION_HEX;

export default function FieldSalesDashboard() {
  const { data, mode, isLoading, error } = useModuleData('field_sales');

  const kpis = useMemo(
    () => (data ? selectKpis(data.properties, data.visits) : null),
    [data]
  );
  const breakdown = useMemo(
    () => (data ? selectDispositionBreakdown(data.properties) : []),
    [data]
  );
  const reps = useMemo(
    () => (data ? selectRepPerformance(data.reps, data.visits, data.properties) : []),
    [data]
  );

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data}>
      {kpis && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Knocks"
              value={kpis.visitsLogged.toLocaleString()}
              note={`${kpis.propertiesVisited.toLocaleString()} doors`}
              accent="amber"
            />
            <Stat
              label="Conversations"
              value={kpis.contacts.toLocaleString()}
              note={`${pct(kpis.contactRate)} of knocks answered`}
              accent="sky"
            />
            <Stat
              label="Appointments"
              value={kpis.appointmentsSet.toLocaleString()}
              // The no-show count next to the booking count, because a crew
              // booking well and showing badly reads as a good week here
              // otherwise. The Funnel view is where the rest of it lives.
              note={
                kpis.appointmentsSet > 0
                  ? `${kpis.appointmentsKept.toLocaleString()} showed, ${kpis.noShows.toLocaleString()} did not`
                  : undefined
              }
              accent="purple"
            />
            <Stat
              label="Sales"
              value={kpis.salesClosed.toLocaleString()}
              note={`${pct(kpis.conversionRate)} of conversations`}
              accent="emerald"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <p className="micro-label mb-4">Outcomes</p>
              <div className="flex h-3 overflow-hidden rounded-full bg-white/8">
                {breakdown.map((slice) => (
                  <span
                    key={slice.disposition}
                    title={`${slice.label}: ${slice.count}`}
                    style={{
                      width: `${slice.share * 100}%`,
                      background: DISPOSITION_COLOR[slice.disposition] ?? 'var(--color-ink-faint)',
                    }}
                  />
                ))}
              </div>
              <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
                {breakdown.map((slice) => (
                  <li key={slice.disposition} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block size-2 rounded-sm"
                      style={{ background: DISPOSITION_COLOR[slice.disposition] }}
                    />
                    {slice.label}
                    <span className="numeric-display">{slice.count}</span>
                    <span className="text-[var(--color-ink-faint)]">{pct(slice.share)}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <p className="micro-label mb-4">Reps</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="micro-label pb-2">Rep</th>
                    <th className="micro-label pb-2 text-right">Knocks</th>
                    <th className="micro-label pb-2 text-right">Contact rate</th>
                    <th className="micro-label pb-2 text-right">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {reps.map((rep) => (
                    <tr key={rep.repId} className="border-t border-[var(--color-hairline)]">
                      <td className="py-2.5">{rep.repName}</td>
                      <td className="numeric-display py-2.5 text-right">{rep.visits}</td>
                      <td className="numeric-display py-2.5 text-right">{pct(rep.contactRate)}</td>
                      <td
                        className={`numeric-display py-2.5 text-right ${accentClasses('emerald').text}`}
                      >
                        {rep.sales}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}
    </ModuleGate>
  );
}
