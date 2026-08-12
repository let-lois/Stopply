export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// A tenant's timezone reaches these formatters straight from the database,
// where it was free text until the API started validating it, so values
// like "California" exist. Intl throws a RangeError on a zone it cannot
// resolve, and since these run inside the dashboard's render path, one bad
// row took the entire client page down with "This page couldn't load"
// rather than mislabelling a date.
//
// Returns undefined for anything unusable, letting each caller keep its own
// existing default. Results are cached because this runs per rendered date.
const tzCache = new Map<string, string | undefined>();

export function safeTimeZone(timezone: string | null | undefined): string | undefined {
  if (!timezone) return undefined;
  if (tzCache.has(timezone)) return tzCache.get(timezone);
  let resolved: string | undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    resolved = timezone;
  } catch {
    resolved = undefined;
  }
  tzCache.set(timezone, resolved);
  return resolved;
}

export function monthLabel(month: string, timezone?: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15));
  return d.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: safeTimeZone(timezone) ?? 'UTC',
  });
}

export function fmtStamp(iso: string | null, timezone?: string): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    // Undefined here means the viewer's own zone, which is what this did
    // before when no timezone was passed.
    timeZone: safeTimeZone(timezone),
  });
}

export const CHANNEL_COLOR_VAR: Record<string, string> = {
  Google: 'var(--ch-google)',
  Meta: 'var(--ch-meta)',
  Website: 'var(--ch-website)',
  Direct: 'var(--ch-website)',
};

export function channelColor(channel: string): string {
  return CHANNEL_COLOR_VAR[channel] ?? 'var(--ink-soft)';
}
