import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPOSITIONS, dispositionIndex } from '../src/dispositions';
import {
  byDay,
  byDisposition,
  byRep,
  dayKey,
  eachDay,
  summarize,
  zonedDayRangeUtc,
  type VisitFact,
} from '../src/stats';

const INDEX = dispositionIndex(DEFAULT_DISPOSITIONS);

function visit(over: Partial<VisitFact> & Pick<VisitFact, 'disposition'>): VisitFact {
  return {
    id: `v_${Math.random().toString(36).slice(2)}`,
    repId: 'r1',
    repName: 'Dana Reyes',
    addressId: `a_${Math.random().toString(36).slice(2)}`,
    occurredAt: '2026-08-11T17:00:00.000Z',
    ...over,
  };
}

describe('summarize', () => {
  it('counts a day of knocking through the funnel', () => {
    const visits = [
      visit({ disposition: 'no_answer' }),
      visit({ disposition: 'no_answer' }),
      visit({ disposition: 'not_interested' }),
      visit({ disposition: 'appointment' }),
      visit({ disposition: 'sale' }),
    ];
    const t = summarize(visits, INDEX);
    expect(t.visits).toBe(5);
    expect(t.contacts).toBe(3);
    expect(t.leads).toBe(2);
    expect(t.appointments).toBe(2);
    expect(t.sales).toBe(1);
    expect(t.contactRate).toBeCloseTo(3 / 5);
    expect(t.closeRate).toBeCloseTo(1 / 3);
    expect(t.knocksPerSale).toBeCloseTo(5);
  });

  it('separates doors touched from knocks logged', () => {
    // The same house knocked three times is one door, three visits. A rep
    // walking one street twice must not read as twice the coverage.
    const visits = [
      visit({ addressId: 'a1', disposition: 'no_answer' }),
      visit({ addressId: 'a1', disposition: 'no_answer' }),
      visit({ addressId: 'a1', disposition: 'appointment' }),
    ];
    const t = summarize(visits, INDEX);
    expect(t.visits).toBe(3);
    expect(t.doors).toBe(1);
  });

  it('reports zeros rather than dividing by zero on an empty range', () => {
    const t = summarize([], INDEX);
    expect(t.visits).toBe(0);
    expect(t.contactRate).toBe(0);
    expect(t.closeRate).toBe(0);
    expect(t.knocksPerSale).toBeNull();
  });

  it('leaves knocksPerSale null when nobody has closed yet', () => {
    const t = summarize([visit({ disposition: 'not_interested' })], INDEX);
    expect(t.sales).toBe(0);
    expect(t.knocksPerSale).toBeNull();
  });

  it('still counts an unknown disposition as a knock', () => {
    // An outcome removed from the catalog must not vanish from the knock
    // count, or coverage numbers silently shrink.
    const t = summarize([visit({ disposition: 'retired_outcome' })], INDEX);
    expect(t.visits).toBe(1);
    expect(t.contacts).toBe(0);
  });
});

describe('byRep', () => {
  it('ranks the rep who converted above the rep who only walked', () => {
    const visits = [
      visit({ repId: 'walker', repName: 'Walker', disposition: 'no_answer' }),
      visit({ repId: 'walker', repName: 'Walker', disposition: 'no_answer' }),
      visit({ repId: 'walker', repName: 'Walker', disposition: 'no_answer' }),
      visit({ repId: 'closer', repName: 'Closer', disposition: 'sale' }),
    ];
    const rows = byRep(visits, INDEX, 'America/Phoenix');
    expect(rows.map((r) => r.repId)).toEqual(['closer', 'walker']);
    expect(rows[0]?.sales).toBe(1);
    expect(rows[1]?.visits).toBe(3);
  });

  it('counts active days in the tenant timezone', () => {
    // Both stamps are the same Phoenix day (UTC-7): 2026-08-11 18:00 and
    // 2026-08-12 02:00 UTC are the 11th at 11:00 and 19:00 locally. Counting
    // in UTC would report two days worked instead of one.
    const visits = [
      visit({ occurredAt: '2026-08-11T18:00:00.000Z', disposition: 'no_answer' }),
      visit({ occurredAt: '2026-08-12T02:00:00.000Z', disposition: 'no_answer' }),
    ];
    expect(byRep(visits, INDEX, 'America/Phoenix')[0]?.activeDays).toBe(1);
    expect(byRep(visits, INDEX, 'UTC')[0]?.activeDays).toBe(2);
  });

  it('names a rep whose rows carry no name rather than showing a blank', () => {
    const rows = byRep([visit({ repName: null, disposition: 'sale' })], INDEX, 'UTC');
    expect(rows[0]?.repName).toBe('Unknown rep');
  });
});

describe('byDisposition', () => {
  it('drops outcomes nobody logged and sorts by volume', () => {
    const visits = [
      visit({ disposition: 'no_answer' }),
      visit({ disposition: 'no_answer' }),
      visit({ disposition: 'sale' }),
    ];
    const rows = byDisposition(visits, DEFAULT_DISPOSITIONS);
    expect(rows.map((r) => r.key)).toEqual(['no_answer', 'sale']);
    expect(rows[0]?.share).toBeCloseTo(2 / 3);
  });

  it('keeps a retired outcome in the breakdown so it still sums to the knocks', () => {
    const visits = [visit({ disposition: 'no_answer' }), visit({ disposition: 'retired_outcome' })];
    const rows = byDisposition(visits, DEFAULT_DISPOSITIONS);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(visits.length);
    expect(rows.some((r) => r.key === 'retired_outcome')).toBe(true);
  });
});

describe('byDay', () => {
  it('buckets by the tenant timezone, not UTC', () => {
    const visits = [
      visit({ occurredAt: '2026-08-12T02:00:00.000Z', disposition: 'sale' }),
    ];
    expect(byDay(visits, INDEX, 'America/Phoenix')[0]?.day).toBe('2026-08-11');
    expect(byDay(visits, INDEX, 'UTC')[0]?.day).toBe('2026-08-12');
  });

  it('fills days nobody knocked so a chart shows the gap', () => {
    const visits = [visit({ occurredAt: '2026-08-10T17:00:00.000Z', disposition: 'sale' })];
    const points = byDay(visits, INDEX, 'UTC', { from: '2026-08-10', to: '2026-08-12' });
    expect(points.map((p) => p.day)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
    expect(points[1]?.visits).toBe(0);
  });
});

describe('dayKey', () => {
  it('falls back to UTC on a timezone the tenant record cannot supply', () => {
    expect(dayKey('2026-08-12T02:00:00.000Z', 'Not/AZone')).toBe('2026-08-12');
  });

  it('does not throw on an unparseable timestamp', () => {
    expect(dayKey('not a date', 'UTC')).toBe('not a date');
  });
});

describe('eachDay', () => {
  it('returns nothing for a backwards range', () => {
    expect(eachDay('2026-08-12', '2026-08-10')).toEqual([]);
  });

  it('caps a runaway range instead of building an unbounded array', () => {
    expect(eachDay('2000-01-01', '2026-01-01').length).toBe(400);
  });
});

describe('zonedDayRangeUtc', () => {
  it('bounds a Phoenix day with the UTC instants it actually spans', () => {
    // Phoenix is UTC-7 year round: 2026-08-12 local runs 07:00Z that day
    // through 06:59:59.999Z the next.
    const r = zonedDayRangeUtc('2026-08-12', '2026-08-12', 'America/Phoenix');
    expect(r.from).toBe('2026-08-12T07:00:00.000Z');
    expect(r.to).toBe('2026-08-13T06:59:59.999Z');
  });

  it('agrees with dayKey at both edges of the window', () => {
    // The guarantee that matters: anything the filter admits buckets to a
    // day inside the requested range, and anything just outside does not.
    const zone = 'America/Phoenix';
    const r = zonedDayRangeUtc('2026-08-12', '2026-08-12', zone);
    expect(dayKey(r.from, zone)).toBe('2026-08-12');
    expect(dayKey(r.to, zone)).toBe('2026-08-12');
    expect(dayKey(new Date(Date.parse(r.from) - 1).toISOString(), zone)).toBe('2026-08-11');
    expect(dayKey(new Date(Date.parse(r.to) + 1).toISOString(), zone)).toBe('2026-08-13');
  });

  it('handles a zone that observes daylight saving', () => {
    const zone = 'America/New_York';
    const summer = zonedDayRangeUtc('2026-08-12', '2026-08-12', zone);
    const winter = zonedDayRangeUtc('2026-01-12', '2026-01-12', zone);
    expect(summer.from).toBe('2026-08-12T04:00:00.000Z');
    expect(winter.from).toBe('2026-01-12T05:00:00.000Z');
  });

  it('lands on the right instant across a spring forward boundary', () => {
    // 2026-03-08 is the US spring forward. The day starts at 05:00Z and the
    // clock jumps at 2am local, so a single offset read taken at the wrong
    // instant would be an hour out.
    const zone = 'America/New_York';
    const r = zonedDayRangeUtc('2026-03-08', '2026-03-08', zone);
    expect(r.from).toBe('2026-03-08T05:00:00.000Z');
    expect(dayKey(r.from, zone)).toBe('2026-03-08');
    expect(dayKey(r.to, zone)).toBe('2026-03-08');
  });

  it('falls back to UTC on a timezone the tenant record cannot supply', () => {
    const r = zonedDayRangeUtc('2026-08-12', '2026-08-12', 'Not/AZone');
    expect(r.from).toBe('2026-08-12T00:00:00.000Z');
    expect(r.to).toBe('2026-08-12T23:59:59.999Z');
  });
});
