// The highest-value tests in the application.
//
// Each case below is a specific way the prototype's hand-incremented counters
// were wrong. Deriving the numbers is what fixes them, and these are what
// keep them fixed.

import type { Property, PropertyDisposition, Rep, Territory, Visit } from '@/modules/field-sales/types';
import {
  selectDispositionBreakdown,
  selectKpis,
  selectRepPerformance,
  selectTerritoryCoverage,
} from '@/modules/field-sales/selectors';

let seq = 0;

function property(disposition: PropertyDisposition, territoryId = 'ter_a'): Property {
  seq++;
  return {
    id: `prop_${seq}`,
    address: `${seq} Test St`,
    city: 'Mesa',
    state: 'AZ',
    postalCode: '85201',
    lat: 33.4,
    lng: -111.8,
    territoryId,
    disposition,
    ownerName: null,
    ownerPhone: null,
    notes: null,
  };
}

function visit(propertyId: string, disposition: PropertyDisposition, repId = 'rep_1'): Visit {
  seq++;
  return {
    id: `visit_${seq}`,
    propertyId,
    repId,
    disposition,
    notes: null,
    occurredAt: '2026-08-13T17:00:00.000Z',
  };
}

describe('selectKpis', () => {
  it('separates properties visited from visits logged', () => {
    // A house knocked three times is one door and three visits. The
    // prototype's propertiesVisited was never updated at all.
    const p = property('no_answer');
    const kpis = selectKpis(
      [p],
      [visit(p.id, 'no_answer'), visit(p.id, 'no_answer'), visit(p.id, 'interested')]
    );
    expect(kpis.visitsLogged).toBe(3);
    expect(kpis.propertiesVisited).toBe(1);
  });

  it('does not double-count a sale when the same close is logged twice', () => {
    // Re-logging Closed Sale on an already-closed property incremented the
    // prototype's counter a second time.
    const p = property('closed_sale');
    const kpis = selectKpis([p], [visit(p.id, 'closed_sale'), visit(p.id, 'closed_sale')]);
    expect(kpis.salesClosed).toBe(1);
  });

  it('lets a lead count go down when a property moves out of Interested', () => {
    // The prototype neither incremented nor decremented on this transition,
    // so interestedLeads only ever grew.
    const before = selectKpis([property('interested')], []);
    const after = selectKpis([property('not_interested')], []);
    expect(before.interestedLeads).toBe(1);
    expect(after.interestedLeads).toBe(0);
  });

  it('counts a contact only where somebody answered', () => {
    const a = property('no_answer');
    const b = property('interested');
    const kpis = selectKpis([a, b], [visit(a.id, 'no_answer'), visit(b.id, 'interested')]);
    expect(kpis.contacts).toBe(1);
    expect(kpis.contactRate).toBeCloseTo(0.5);
  });

  it('measures conversion against conversations, not knocks', () => {
    const sold = property('closed_sale');
    const cold = property('not_interested');
    const empty = property('no_answer');
    const kpis = selectKpis(
      [sold, cold, empty],
      [visit(sold.id, 'closed_sale'), visit(cold.id, 'not_interested'), visit(empty.id, 'no_answer')]
    );
    expect(kpis.contacts).toBe(2);
    expect(kpis.conversionRate).toBeCloseTo(0.5);
  });

  it('reports zeros rather than dividing by zero on an empty territory', () => {
    const kpis = selectKpis([], []);
    expect(kpis.contactRate).toBe(0);
    expect(kpis.conversionRate).toBe(0);
    expect(kpis.coveragePct).toBe(0);
  });

  it('recomputes coverage when a property is added', () => {
    // Territory coverage never responded to new properties in the prototype.
    const a = property('no_answer');
    const before = selectKpis([a], [visit(a.id, 'no_answer')]);
    const after = selectKpis([a, property('not_visited')], [visit(a.id, 'no_answer')]);
    expect(before.coveragePct).toBe(1);
    expect(after.coveragePct).toBeCloseTo(0.5);
  });
});

describe('selectDispositionBreakdown', () => {
  it('reflects the current properties rather than a frozen seed', () => {
    const rows = selectDispositionBreakdown([
      property('no_answer'),
      property('no_answer'),
      property('closed_sale'),
    ]);
    const byKey = Object.fromEntries(rows.map((r) => [r.disposition, r.count]));
    expect(byKey.no_answer).toBe(2);
    expect(byKey.closed_sale).toBe(1);
  });

  it('sums to the property count', () => {
    const properties = [property('no_answer'), property('interested'), property('not_visited')];
    const rows = selectDispositionBreakdown(properties);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(properties.length);
  });

  it('omits dispositions nobody has used', () => {
    const rows = selectDispositionBreakdown([property('no_answer')]);
    expect(rows.map((r) => r.disposition)).toEqual(['no_answer']);
  });
});

describe('selectTerritoryCoverage', () => {
  const territories: Territory[] = [
    {
      id: 'ter_a',
      name: 'North Ridge',
      bounds: { north: 1, south: 0, east: 1, west: 0 },
      boundary: null, repIds: ['rep_1'],
    },
  ];
  const reps: Rep[] = [{ id: 'rep_1', name: 'Dana Reyes', territoryId: 'ter_a' }];

  it('derives coverage from visits', () => {
    const a = property('no_answer');
    const b = property('not_visited');
    const rows = selectTerritoryCoverage(territories, [a, b], [visit(a.id, 'no_answer')], reps);
    expect(rows[0]).toMatchObject({ totalProperties: 2, visitedProperties: 1 });
    expect(rows[0]?.coveragePct).toBeCloseTo(0.5);
  });

  it('names every rep on the territory, and copes with none', () => {
    // Plural, because a territory can genuinely have a crew on it. The single
    // assignedRepId this replaces was a second copy of reps.territoryId
    // pointing the other way, and the two could disagree about who was
    // working an area.
    const withRep = selectTerritoryCoverage(territories, [], [], reps);
    expect(withRep[0]?.assignedRepNames).toEqual(['Dana Reyes']);

    const unassigned = selectTerritoryCoverage(
      [{ ...territories[0]!, boundary: null, repIds: [] }],
      [],
      [],
      reps
    );
    expect(unassigned[0]?.assignedRepNames).toEqual([]);
  });

  it('drops a rep id that matches nobody rather than rendering a blank name', () => {
    const ghost = selectTerritoryCoverage(
      [{ ...territories[0]!, repIds: ['rep_gone', reps[0]!.id] }],
      [],
      [],
      reps
    );
    expect(ghost[0]?.assignedRepNames).toEqual(['Dana Reyes']);
  });
});

describe('selectRepPerformance', () => {
  const reps: Rep[] = [
    { id: 'walker', name: 'Walker', territoryId: null },
    { id: 'closer', name: 'Closer', territoryId: null },
  ];

  it('ranks the rep who converted above the rep who only walked', () => {
    const empty1 = property('no_answer');
    const empty2 = property('no_answer');
    const sold = property('closed_sale');
    const rows = selectRepPerformance(
      reps,
      [
        visit(empty1.id, 'no_answer', 'walker'),
        visit(empty2.id, 'no_answer', 'walker'),
        visit(sold.id, 'closed_sale', 'closer'),
      ],
      [empty1, empty2, sold]
    );
    expect(rows.map((r) => r.repId)).toEqual(['closer', 'walker']);
    expect(rows[1]?.visits).toBe(2);
  });

  it('withdraws credit for a sale that was later reversed', () => {
    const reversed = property('not_interested');
    const rows = selectRepPerformance(reps, [visit(reversed.id, 'closed_sale', 'closer')], [reversed]);
    expect(rows.find((r) => r.repId === 'closer')?.sales).toBe(0);
  });
});
