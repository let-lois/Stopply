import type { ViewConfig } from '@letlois/db';

// Viewer view configs gate tabs, months, and channels. Present and Data
// and Team are never grantable: any config that tries is sanitized here
// before storage and again on read, so a hand edited row cannot widen
// access.
const GRANTABLE_TABS = ['performance', 'work-backwards', 'planning'] as const;

export function sanitizeViewConfig(raw: unknown): ViewConfig {
  const fallback: ViewConfig = { tabs: ['performance'], months: 'all', channels: 'all' };
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;

  const tabs = Array.isArray(obj.tabs)
    ? (obj.tabs.filter((t): t is ViewConfig['tabs'][number] =>
        (GRANTABLE_TABS as readonly string[]).includes(String(t))
      ) as ViewConfig['tabs'])
    : fallback.tabs;

  let months: ViewConfig['months'] = 'all';
  if (Array.isArray(obj.months)) {
    months = obj.months.map(String).filter((m) => /^\d{4}-\d{2}$/.test(m));
  }

  let channels: ViewConfig['channels'] = 'all';
  if (Array.isArray(obj.channels)) {
    channels = obj.channels.map(String).slice(0, 50);
  }

  return { tabs: tabs.length ? tabs : fallback.tabs, months, channels };
}

export function parseViewConfig(json: string | null): ViewConfig | null {
  if (!json) return null;
  try {
    return sanitizeViewConfig(JSON.parse(json));
  } catch {
    return null;
  }
}

export function monthAllowed(config: ViewConfig | null, month: string): boolean {
  if (!config || config.months === 'all') return true;
  return config.months.includes(month);
}

export function channelAllowed(config: ViewConfig | null, channel: string): boolean {
  if (!config || config.channels === 'all') return true;
  return config.channels.includes(channel);
}
