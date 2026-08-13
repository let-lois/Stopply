// Cutting a day in someone else's timezone.
//
// Every number on a field report is "per day", and which day a knock lands on
// depends entirely on where the line is drawn. A knock at 11pm in Riverside is
// 6am the next day in UTC. Cut the day in UTC and the crew's Tuesday total
// disagrees with the crew's own count of their own Tuesday, which is the kind
// of discrepancy that costs more trust than the feature is worth.
//
// The rule this file exists to enforce: the filter that selects the visits and
// the buckets that group them must use the same cut. When they did not, the
// headline total and the chart underneath it disagreed by exactly the knocks
// in the overlap.
//
// Intl rather than a date library. The zone data is already in the runtime and
// already correct across daylight saving, which is the only hard part.

/** YYYY-MM-DD for an instant, as seen in the given zone. Sorts as a string. */
export function zonedDayKey(iso: string | Date, timeZone: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return typeof iso === 'string' ? iso.slice(0, 10) : '';
  // en-CA formats as YYYY-MM-DD. Asking for the parts and reassembling them
  // would be the same work with more places to get the padding wrong.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * The last `days` day-keys ending at `now`, oldest first.
 *
 * Built by walking back a day at a time from the current instant and asking
 * the zone what day that was, rather than by decrementing a date. Around a
 * daylight saving change the two disagree, and only the first is right.
 */
export function recentDayKeys(days: number, timeZone: string, now: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(zonedDayKey(new Date(now.getTime() - i * 86400000), timeZone));
  }
  // A spring-forward day can produce a repeat when stepping by fixed hours.
  // Deduplicating here is cheaper than a chart with the same day twice.
  return [...new Set(keys)];
}

/**
 * Whether an instant falls in the window of the last `days` days in this zone.
 *
 * Expressed against the same day-keys the buckets use, deliberately, rather
 * than as a millisecond comparison. A millisecond window is easier to write
 * and is how the filter and the buckets came apart.
 */
export function inRecentDays(
  iso: string,
  days: number,
  timeZone: string,
  now: Date = new Date()
): boolean {
  const keys = recentDayKeys(days, timeZone, now);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) return false;
  const key = zonedDayKey(iso, timeZone);
  return key >= first && key <= last;
}

/** A day-key rendered for a chart axis: "13 Aug". */
export function dayKeyLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  // Read back in UTC, the zone it was just written in. The key is already a
  // calendar date and has no instant to re-interpret; converting it into any
  // other zone can only move it, and for a zone far enough east it does.
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(date);
}
