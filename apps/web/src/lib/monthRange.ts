// Master Date range helpers. `months` arrives newest first (per the
// /api/tenant/months contract), so "range" here means an inclusive slice
// of that array between two picked months, regardless of which one the
// user picked as "start" vs "end".

export function monthsInRange(months: string[], start: string, end: string): string[] {
  const ia = months.indexOf(start);
  const ib = months.indexOf(end);
  if (ia === -1 && ib === -1) return [];
  if (ia === -1) return [months[ib]!];
  if (ib === -1) return [months[ia]!];
  const lo = Math.min(ia, ib);
  const hi = Math.max(ia, ib);
  return months.slice(lo, hi + 1);
}

export function shiftYear(month: string, deltaYears: number): string {
  const year = Number(month.slice(0, 4)) + deltaYears;
  return `${year}${month.slice(4)}`;
}
