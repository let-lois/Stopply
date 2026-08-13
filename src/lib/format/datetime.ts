// The render boundary for time.
//
// Every timestamp in this application is stored as ISO 8601 and formatted
// here. The prototype mixed '2026-08-13 08:20:14', 'Just now', '2 mins ago',
// 'Today, 2:15 PM' and 'Aug 11, 4:20 PM' in fields typed string, which made
// sorting impossible and comparison meaningless.
//
// Locale and timezone are the viewer's. This is an operations tool used by
// the people whose day it describes, so their local clock is the right one;
// a workspace-level override belongs in Phase 2, where a client record can
// carry a timezone the server also reports in.

const RELATIVE_THRESHOLDS: Array<[limitSeconds: number, divisor: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [604800, 86400, 'day'],
  [2629800, 604800, 'week'],
  [31557600, 2629800, 'month'],
  [Infinity, 31557600, 'year'],
];

function parse(iso: string): Date | undefined {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** "3 minutes ago", "in 2 days". Falls back to the raw value if unparseable. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const date = parse(iso);
  if (!date) return iso;

  const deltaSeconds = (date.getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  for (const [limit, divisor, unit] of RELATIVE_THRESHOLDS) {
    if (magnitude < limit) {
      return formatter.format(Math.round(deltaSeconds / divisor), unit);
    }
  }
  return formatter.format(Math.round(deltaSeconds / 31557600), 'year');
}

/** "13 Aug 2026". */
export function shortDate(iso: string): string {
  const date = parse(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** "13 Aug 2026, 14:20". */
export function dateTime(iso: string): string {
  const date = parse(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** "14:20". */
export function timeOfDay(iso: string): string {
  const date = parse(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** YYYY-MM-DD in the viewer's timezone, for grouping a series into days. */
export function dayKey(iso: string): string {
  const date = parse(iso);
  if (!date) return iso.slice(0, 10);
  // en-CA formats as YYYY-MM-DD, which sorts correctly as a string.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
