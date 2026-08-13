// Reporting aggregation over field visits. Pure functions: the Worker
// feeds them rows from the tenant database and the dashboard feeds them the
// same rows over the wire, so a number shown to a client and a number
// computed server side cannot disagree.

import type { Disposition } from './dispositions';

export interface VisitFact {
  id: string;
  repId: string;
  repName: string | null;
  addressId: string;
  disposition: string;
  occurredAt: string;
}

export interface FieldTotals {
  // Every door interaction logged. A house knocked three times is three.
  visits: number;
  // Distinct addresses touched. The same house knocked three times is one.
  doors: number;
  contacts: number;
  leads: number;
  appointments: number;
  sales: number;
  // Share of knocks where somebody actually answered.
  contactRate: number;
  // Of the people who answered, how many became a lead.
  leadRate: number;
  // Of the people who answered, how many bought. Measured against contacts
  // rather than knocks because a rep controls how many doors they knock but
  // not how many people are home, and closing is judged on conversations.
  closeRate: number;
  // The number every door to door manager actually runs the team on.
  knocksPerSale: number | null;
}

export interface RepStats extends FieldTotals {
  repId: string;
  repName: string;
  activeDays: number;
}

export interface DispositionCount {
  key: string;
  label: string;
  color: string | null;
  count: number;
  share: number;
}

export interface DayPoint {
  day: string;
  visits: number;
  contacts: number;
  appointments: number;
  sales: number;
}

const ZERO_TOTALS: FieldTotals = {
  visits: 0,
  doors: 0,
  contacts: 0,
  leads: 0,
  appointments: 0,
  sales: 0,
  contactRate: 0,
  leadRate: 0,
  closeRate: 0,
  knocksPerSale: null,
};

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function summarize(
  visits: VisitFact[],
  dispositions: Map<string, Disposition>
): FieldTotals {
  if (visits.length === 0) return { ...ZERO_TOTALS };

  const doors = new Set<string>();
  let contacts = 0;
  let leads = 0;
  let appointments = 0;
  let sales = 0;

  for (const v of visits) {
    doors.add(v.addressId);
    const d = dispositions.get(v.disposition);
    if (!d) continue;
    if (d.isContact) contacts++;
    if (d.isLead) leads++;
    if (d.isAppointment) appointments++;
    if (d.isSale) sales++;
  }

  return {
    visits: visits.length,
    doors: doors.size,
    contacts,
    leads,
    appointments,
    sales,
    contactRate: ratio(contacts, visits.length),
    leadRate: ratio(leads, contacts),
    closeRate: ratio(sales, contacts),
    knocksPerSale: sales > 0 ? visits.length / sales : null,
  };
}

// Per rep leaderboard. Sorted by sales, then appointments, then knocks, so
// the rep who converted beats the rep who only walked far.
export function byRep(
  visits: VisitFact[],
  dispositions: Map<string, Disposition>,
  timeZone: string
): RepStats[] {
  const groups = new Map<string, VisitFact[]>();
  for (const v of visits) {
    const list = groups.get(v.repId);
    if (list) list.push(v);
    else groups.set(v.repId, [v]);
  }

  const out: RepStats[] = [];
  for (const [repId, list] of groups) {
    const days = new Set(list.map((v) => dayKey(v.occurredAt, timeZone)));
    out.push({
      repId,
      repName: list.find((v) => v.repName)?.repName ?? 'Unknown rep',
      activeDays: days.size,
      ...summarize(list, dispositions),
    });
  }

  return out.sort(
    (a, b) => b.sales - a.sales || b.appointments - a.appointments || b.visits - a.visits
  );
}

export function byDisposition(
  visits: VisitFact[],
  dispositions: Disposition[]
): DispositionCount[] {
  const counts = new Map<string, number>();
  for (const v of visits) counts.set(v.disposition, (counts.get(v.disposition) ?? 0) + 1);

  const total = visits.length;
  const known = dispositions.map((d) => ({
    key: d.key,
    label: d.label,
    color: d.color,
    count: counts.get(d.key) ?? 0,
    share: ratio(counts.get(d.key) ?? 0, total),
  }));

  // An outcome that was logged but is no longer in the catalog (renamed,
  // deactivated) still has to show up, or the breakdown stops summing to
  // the knock count and every number on the page looks wrong.
  const knownKeys = new Set(dispositions.map((d) => d.key));
  const orphans: DispositionCount[] = [];
  for (const [key, count] of counts) {
    if (knownKeys.has(key)) continue;
    orphans.push({ key, label: key, color: null, count, share: ratio(count, total) });
  }

  return [...known, ...orphans].filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
}

// Daily series in the tenant's own timezone, with empty days filled in so a
// chart shows the gap where nobody knocked instead of drawing straight over
// it.
export function byDay(
  visits: VisitFact[],
  dispositions: Map<string, Disposition>,
  timeZone: string,
  range?: { from: string; to: string }
): DayPoint[] {
  const points = new Map<string, DayPoint>();

  const touch = (day: string): DayPoint => {
    let p = points.get(day);
    if (!p) {
      p = { day, visits: 0, contacts: 0, appointments: 0, sales: 0 };
      points.set(day, p);
    }
    return p;
  };

  for (const v of visits) {
    const p = touch(dayKey(v.occurredAt, timeZone));
    p.visits++;
    const d = dispositions.get(v.disposition);
    if (!d) continue;
    if (d.isContact) p.contacts++;
    if (d.isAppointment) p.appointments++;
    if (d.isSale) p.sales++;
  }

  if (range) for (const day of eachDay(range.from, range.to)) touch(day);

  return [...points.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// YYYY-MM-DD in the given timezone.
//
// A tenant's stored timezone is free text and has arrived unusable before,
// which is enough to throw out of Intl and take a whole page down. An
// unusable zone falls back to UTC rather than failing the report.
export function dayKey(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  try {
    // en-CA formats as YYYY-MM-DD, which sorts correctly as a string.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

// The UTC instant offset of a timezone at a given moment, in milliseconds.
// Derived by formatting the instant in that zone and reading the wall clock
// back, which is the only way to get this without a timezone database.
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return asIfUtc - utcMs;
}

// Converts a calendar day range in the tenant's timezone into the UTC
// instants that bound it.
//
// Without this a client asking for "August 12" gets whatever August 12 means
// in UTC, which in Phoenix starts at 5pm on the 11th. Knocks logged in the
// evening would then land in the next day's totals, and the headline number
// would disagree with the daily chart directly beneath it.
export function zonedDayRangeUtc(
  fromDay: string,
  toDay: string,
  timeZone: string
): { from: string; to: string } {
  const localMidnightUtc = (day: string, endOfDay: boolean): number => {
    const naive = Date.parse(`${day}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (Number.isNaN(naive)) return endOfDay ? Number.MAX_SAFE_INTEGER : 0;
    try {
      // Probed on a whole second: formatToParts resolves no finer, so an
      // instant carrying milliseconds would fold them into the offset and
      // shift the boundary by up to a second.
      const offsetAt = (ms: number) => zoneOffsetMs(Math.floor(ms / 1000) * 1000, timeZone);
      // Two passes: the first offset is read at the wrong instant when the
      // range crosses a daylight saving change, and the second corrects it.
      let utc = naive - offsetAt(naive);
      utc = naive - offsetAt(utc);
      return utc;
    } catch {
      // An unusable timezone falls back to UTC rather than failing the
      // report, matching dayKey above.
      return naive;
    }
  };
  return {
    from: new Date(localMidnightUtc(fromDay, false)).toISOString(),
    to: new Date(localMidnightUtc(toDay, true)).toISOString(),
  };
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out;
  // A year of daily points is already more than any chart can show. The cap
  // stops a mistyped range from building an unbounded array.
  for (let t = start, guard = 0; t <= end && guard < 400; t += 86400000, guard++) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
