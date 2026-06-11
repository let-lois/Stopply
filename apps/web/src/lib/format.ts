export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function monthLabel(month: string, timezone?: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: timezone ?? 'UTC' });
}

export function fmtStamp(iso: string | null, timezone?: string): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
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
