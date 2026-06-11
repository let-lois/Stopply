import { describe, it, expect } from 'vitest';
import { sanitizeViewConfig, monthAllowed, channelAllowed } from '../src/viewConfig';

describe('sanitizeViewConfig', () => {
  it('never grants Present or Data and Team tabs', () => {
    const config = sanitizeViewConfig({
      tabs: ['performance', 'present', 'data-team', 'planning'],
      months: 'all',
      channels: 'all',
    });
    expect(config.tabs).toEqual(['performance', 'planning']);
  });

  it('drops malformed months and keeps valid YYYY-MM values', () => {
    const config = sanitizeViewConfig({ tabs: ['performance'], months: ['2026-05', 'DROP TABLE', '05/2026'] });
    expect(config.months).toEqual(['2026-05']);
  });

  it('falls back to a performance only config on garbage input', () => {
    const config = sanitizeViewConfig('not an object');
    expect(config.tabs).toEqual(['performance']);
    expect(config.months).toBe('all');
  });
});

describe('month and channel gates', () => {
  const config = sanitizeViewConfig({ tabs: ['performance'], months: ['2026-05'], channels: ['Google'] });

  it('filters months server side', () => {
    expect(monthAllowed(config, '2026-05')).toBe(true);
    expect(monthAllowed(config, '2026-04')).toBe(false);
    expect(monthAllowed(null, '2026-04')).toBe(true);
  });

  it('filters channels server side', () => {
    expect(channelAllowed(config, 'Google')).toBe(true);
    expect(channelAllowed(config, 'Meta')).toBe(false);
  });
});
