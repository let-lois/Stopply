import { describe, it, expect } from 'vitest';
import {
  parseMoney,
  parseCount,
  toIso,
  monthOf,
  daysBetween,
  phoneLast10,
  emailNorm,
  nameNorm,
} from '../src/normalize';
import { deriveChannel, readClickId } from '../src/channels';

describe('parseMoney', () => {
  it('parses currency strings to numbers', () => {
    expect(parseMoney('$1,234.56')).toBe(1234.56);
    expect(parseMoney('(500.00)')).toBe(-500);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney(42)).toBe(42);
  });
});

describe('toIso', () => {
  it('normalizes US dates with and without time', () => {
    expect(toIso('5/12/2026')).toBe('2026-05-12T00:00:00.000Z');
    expect(toIso('5/12/2026 3:24 pm')).toBe('2026-05-12T15:24:00.000Z');
    expect(toIso('12/31/2025 12:05 am')).toBe('2025-12-31T00:05:00.000Z');
  });
  it('passes ISO through', () => {
    expect(toIso('2026-05-12T15:24:00.000Z')).toBe('2026-05-12T15:24:00.000Z');
    expect(toIso('2026-05-12')).toBe('2026-05-12T00:00:00.000Z');
  });
  it('returns null for junk', () => {
    expect(toIso('not a date')).toBeNull();
    expect(toIso('')).toBeNull();
    expect(toIso('13/45/2026')).toBeNull();
  });
});

describe('identity normalizers', () => {
  it('phoneLast10 keeps the last ten digits', () => {
    expect(phoneLast10('+1 (602) 555-0142')).toBe('6025550142');
    expect(phoneLast10('555-0142')).toBeNull();
  });
  it('emailNorm lowercases and validates loosely', () => {
    expect(emailNorm(' Jane@Example.COM ')).toBe('jane@example.com');
    expect(emailNorm('not-an-email')).toBeNull();
  });
  it('nameNorm is order independent and strips punctuation', () => {
    expect(nameNorm('Doe, Jane')).toBe('doe jane');
    expect(nameNorm('Jane DOE')).toBe('doe jane');
    expect(nameNorm("Mary-Jane O'Brien")).toBe('maryjane obrien');
  });
});

describe('month helpers', () => {
  it('monthOf and daysBetween', () => {
    expect(monthOf('2026-05-12T15:24:00.000Z')).toBe('2026-05');
    expect(daysBetween('2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z')).toBe(30);
  });
});

describe('deriveChannel', () => {
  it('click ids win over everything', () => {
    expect(deriveChannel({ gclid: 'x', tags: 'facebook' })).toBe('Google');
    expect(deriveChannel({ wbraid: 'x', utmSource: 'facebook' })).toBe('Google');
    expect(deriveChannel({ fbclid: 'x', utmSource: 'google' })).toBe('Meta');
  });
  it('falls through utm, site source, campaign, then tags', () => {
    expect(deriveChannel({ utmSource: 'adwords' })).toBe('Google');
    expect(deriveChannel({ utmSource: '', siteSourceName: 'ig' })).toBe('Meta');
    expect(deriveChannel({ campaignName: 'FB Lead Gen' })).toBe('Meta');
    expect(deriveChannel({ tags: 'google ppc lead' })).toBe('Google');
    expect(deriveChannel({ tags: 'tiktok lead' })).toBe('Other');
  });
  it('maps website origins and unknowns', () => {
    expect(deriveChannel({ utmSource: 'website form' })).toBe('Website');
    expect(deriveChannel({ fromWebsite: true })).toBe('Website');
    expect(deriveChannel({})).toBe('Unknown');
  });
});

describe('readClickId', () => {
  it('reads both clickld and clickid spellings', () => {
    expect(readClickId({ clickld: 'a1' })).toBe('a1');
    expect(readClickId({ clickid: 'a2' })).toBe('a2');
    expect(readClickId({ 'Click Id': 'a3' })).toBe('a3');
    expect(readClickId({ other: 'x' })).toBeNull();
  });
});
