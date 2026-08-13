// Where the work goes, and where it stops going.
//
// One question in five numbers: of the doors the crew knocked, how many turned
// into a conversation, a booking, an appointment somebody turned up to, and a
// sale. The gap between the last two is the one this view exists for. It was
// invisible before, because a booking nobody attended and a booking that had
// not happened yet were the same row in the database.
//
// Every number here is cut in the client's timezone, including the chart, and
// they read the same day-keys so the headline and the chart underneath it
// cannot disagree.

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Car, TrendingDown } from 'lucide-react';
import { useModuleData } from '@/lib/data/useModuleData';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { ModuleGate } from '@/components/ModuleStates';
import { Card, Stat } from '@/components/ui';
import {
  selectFunnel,
  selectRepStageCredit,
  selectStageDays,
  selectVehicleSignal,
} from '@/modules/field-sales/funnel';
import { dayKeyLabel, inRecentDays, recentDayKeys } from '@/lib/format/zonedDay';

const pct = (n: number) => `${Math.round(n * 100)}%`;

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

// The same colours as the chart below, so the two are read as one thing. A
// single amber for every stage made the funnel and the legend underneath it
// look like unrelated charts.
const STAGE_BAR: Record<string, string> = {
  knocked: '#f59e0b',
  contacted: '#38bdf8',
  booked: '#a855f7',
  showed: '#6366f1',
  sold: '#10b981',
};

/**
 * Hours, rendered as something a manager reads rather than a decimal.
 *
 * Null for a gap of zero, which is not "instant" but "the same knock reached
 * both stages". Rendering that as "under an hour typical" put a time on a
 * transition that never took any time, on most rows, which is noise.
 */
function gap(hours: number | null): string | null {
  if (hours === null || hours <= 0) return null;
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function FieldSalesFunnel() {
  const { data, mode, isLoading, error } = useModuleData('field_sales');
  const { clientId } = useParams<{ clientId: string }>();
  const { clients } = usePlatform();
  const [days, setDays] = useState<number>(30);

  // The client's zone, not the reader's. A manager in Arizona looking at a
  // California crew would otherwise see every day boundary move by an hour.
  const timeZone =
    clients.find((c) => c.id === clientId)?.timezone ?? 'America/Los_Angeles';

  const dayKeys = useMemo(() => recentDayKeys(days, timeZone), [days, timeZone]);

  // Cut once, here, and handed to every selector below. Letting each one take
  // a range and cut its own is how the headline total and the chart came to
  // disagree by exactly the knocks in the overlap.
  const visits = useMemo(
    () => (data?.visits ?? []).filter((v) => inRecentDays(v.occurredAt, days, timeZone)),
    [data, days, timeZone]
  );

  const report = useMemo(() => selectFunnel(visits), [visits]);
  const repRows = useMemo(
    () => selectRepStageCredit(data?.reps ?? [], visits),
    [data, visits]
  );
  const stageDays = useMemo(
    () => selectStageDays(visits, timeZone, dayKeys),
    [visits, timeZone, dayKeys]
  );
  const vehicle = useMemo(() => selectVehicleSignal(visits), [visits]);

  const chartRows = useMemo(
    () => stageDays.map((d) => ({ ...d, label: dayKeyLabel(d.dayKey) })),
    [stageDays]
  );

  const knocked = report.steps[0]?.doors ?? 0;
  const sold = report.steps[4]?.doors ?? 0;

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex gap-1 rounded-xl border border-[var(--color-hairline)] p-1"
            role="group"
            aria-label="Date range"
          >
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                aria-pressed={days === range.days}
                onClick={() => setDays(range.days)}
                className={`min-h-9 rounded-lg px-3 text-sm font-medium ${
                  days === range.days
                    ? 'bg-fill text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-soft)]'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
          {/* Named rather than left to be inferred from the numbers. Which
              clock a day was cut on is not a detail when the reader is in a
              different one. */}
          <p className="text-xs text-[var(--color-ink-faint)]">
            Days cut in {timeZone.replace(/_/g, ' ')}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Doors knocked" value={knocked.toLocaleString()} accent="amber" />
          <Stat
            label="Booked"
            value={(report.steps[2]?.doors ?? 0).toLocaleString()}
            note={`${pct(report.steps[2]?.overallConversion ?? 0)} of doors`}
            accent="purple"
          />
          <Stat
            label="Showed"
            value={(report.steps[3]?.doors ?? 0).toLocaleString()}
            note={report.showRate === null ? 'No bookings yet' : `${pct(report.showRate)} of bookings`}
            accent="indigo"
          />
          <Stat
            label="Sold"
            value={sold.toLocaleString()}
            note={`${pct(report.steps[4]?.overallConversion ?? 0)} of doors`}
            accent="emerald"
          />
        </div>

        {/* Says the two numbers differ and why, rather than showing whichever
            is larger and letting the reader find the discrepancy later. */}
        {report.standingSold !== sold && (
          <p className="text-sm text-[var(--color-ink-soft)]">
            {sold - report.standingSold} of these{' '}
            {sold - report.standingSold === 1 ? 'sales was' : 'sales were'} later marked as
            something else. {report.standingSold.toLocaleString()} still stand as sold.
          </p>
        )}

        <Card>
          <p className="micro-label mb-4">The funnel</p>
          <ul className="flex flex-col gap-3">
            {report.steps.map((step, index) => (
              <li key={step.stage}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{step.label}</span>
                  <span className="flex items-baseline gap-3">
                    {gap(step.medianHoursFromPrevious) !== null && (
                      <span className="text-xs text-[var(--color-ink-faint)]">
                        {gap(step.medianHoursFromPrevious)} typical
                      </span>
                    )}
                    {index > 0 && (
                      <span className="text-xs text-[var(--color-ink-soft)]">
                        {pct(step.stepConversion)}
                      </span>
                    )}
                    <span className="numeric-display">{step.doors.toLocaleString()}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-fill-subtle">
                  <div
                    className="h-full rounded-full"
                    // Width against the widest step, so the bars are a shape
                    // and not five near-identical full-width blocks.
                    style={{
                      width: `${(step.overallConversion || 0) * 100}%`,
                      background: STAGE_BAR[step.stage],
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>

          {report.noShows > 0 && (
            <p className="mt-5 flex items-center gap-2 border-t border-[var(--color-hairline)] pt-4 text-sm">
              <TrendingDown size={16} className="text-[var(--color-accent-rose)]" aria-hidden="true" />
              <span>
                <strong className="numeric-display">{report.noShows.toLocaleString()}</strong>{' '}
                booked {report.noShows === 1 ? 'appointment' : 'appointments'} nobody turned up
                to.
              </span>
            </p>
          )}
        </Card>

        <Card>
          <p className="micro-label mb-4">By day</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows}>
                {/* The hairline token, not a fixed white at 6%. A white grid
                    on a white card is no grid at all. */}
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" />
                <XAxis dataKey="label" stroke="var(--color-ink-faint)" fontSize={12} />
                <YAxis stroke="var(--color-ink-faint)" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-raised)',
                    border: '1px solid var(--color-hairline)',
                    borderRadius: '0.75rem',
                  }}
                />
                {/* The label in ink, not in the series colour, which is what
                    Recharts does by default. An amber word on a white card is
                    2:1, and the swatch beside it already carries the colour. */}
                <Legend
                  formatter={(value: string) => (
                    <span style={{ color: 'var(--color-ink-soft)' }}>{value}</span>
                  )}
                />
                <Bar dataKey="knocked" name="Knocked" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="booked" name="Booked" fill="#a855f7" radius={[3, 3, 0, 0]} />
                <Bar dataKey="showed" name="Showed" fill="#6366f1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="sold" name="Sold" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <p className="micro-label mb-4">Who did what</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="micro-label pb-2">Rep</th>
                    <th className="micro-label pb-2 text-right">Knocked</th>
                    <th className="micro-label pb-2 text-right">Booked</th>
                    <th className="micro-label pb-2 text-right">Showed</th>
                    <th className="micro-label pb-2 text-right">Sold</th>
                    {/* A setter's whole contribution is invisible without
                        this column: they book doors somebody else closes. */}
                    <th className="micro-label pb-2 text-right">Passed on</th>
                  </tr>
                </thead>
                <tbody>
                  {repRows.map((rep) => (
                    <tr key={rep.repId} className="border-t border-[var(--color-hairline)]">
                      <td className="py-2.5">{rep.repName}</td>
                      <td className="numeric-display py-2.5 text-right">{rep.knocked}</td>
                      <td className="numeric-display py-2.5 text-right">{rep.booked}</td>
                      <td className="numeric-display py-2.5 text-right">{rep.showed}</td>
                      <td className="numeric-display py-2.5 text-right text-[var(--color-positive)]">
                        {rep.sold}
                      </td>
                      <td className="numeric-display py-2.5 text-right text-[var(--color-ink-soft)]">
                        {rep.passedOn}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <p className="micro-label mb-4">Cars on the drive</p>
            {vehicle.observed === 0 ? (
              // Not a zero, because zero would read as "cars make no
              // difference" when what happened is that nobody recorded one.
              <p className="text-sm text-[var(--color-ink-soft)]">
                No knocks in this window recorded whether there was a car. Reps mark it on the
                knock sheet, and it is optional, so this stays empty until they do.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-4">
                  {[
                    { label: 'Car on the drive', row: vehicle.withCar, tone: 'var(--color-accent-sky)' },
                    { label: 'No car', row: vehicle.withoutCar, tone: 'var(--color-accent-slate)' },
                  ].map((entry) => (
                    <div key={entry.label}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          <Car size={15} aria-hidden="true" />
                          {entry.label}
                        </span>
                        <span>
                          <span className="numeric-display">{pct(entry.row.contactRate)}</span>{' '}
                          <span className="text-xs text-[var(--color-ink-faint)]">
                            answered, {entry.row.visits.toLocaleString()} knocks
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-fill-subtle">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${entry.row.contactRate * 100}%`,
                            background: entry.tone,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
                  Over the {vehicle.observed.toLocaleString()} knocks where a rep said either
                  way. Knocks where nobody looked are left out rather than counted as no car.
                </p>
              </>
            )}
          </Card>
        </div>
      </div>
    </ModuleGate>
  );
}
