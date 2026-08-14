import { dayKey, relativeTime, shortDate } from '@/lib/format/datetime';

describe('relativeTime', () => {
  const now = new Date('2026-08-13T12:00:00.000Z');

  it('describes the recent past', () => {
    expect(relativeTime('2026-08-13T11:57:00.000Z', now)).toContain('3 minutes ago');
  });

  it('describes the future', () => {
    expect(relativeTime('2026-08-15T12:00:00.000Z', now)).toContain('2 days');
  });

  it('returns the raw value rather than throwing on an unparseable date', () => {
    // The prototype stored 'Just now' in fields typed string. Any of that
    // surviving in old storage must not take a page down.
    expect(relativeTime('Just now', now)).toBe('Just now');
  });
});

describe('shortDate', () => {
  it('formats an ISO timestamp', () => {
    expect(shortDate('2026-08-13T12:00:00.000Z')).toMatch(/2026/);
  });
});

describe('dayKey', () => {
  it('produces a sortable key', () => {
    const days = ['2026-08-13T12:00:00.000Z', '2026-08-09T12:00:00.000Z'].map(dayKey);
    expect([...days].sort()).toEqual([days[1], days[0]]);
  });
});
