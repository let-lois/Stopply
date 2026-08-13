// The funnel's rules, each one a decision that could reasonably have gone the
// other way. These are what stop it drifting back.

import type { PropertyDisposition, Rep, Visit } from '@/modules/field-sales/types';
import {
  buildJourneys,
  selectFunnel,
  selectRepStageCredit,
  selectStageDays,
  selectVehicleSignal,
  stillAt,
} from '@/modules/field-sales/funnel';
import { recentDayKeys, zonedDayKey } from '@/lib/format/zonedDay';

let seq = 0;

function visit(
  propertyId: string,
  disposition: PropertyDisposition,
  occurredAt: string,
  repId = 'rep_1'
): Visit {
  seq++;
  return {
    id: `vis_${seq}`,
    propertyId,
    repId,
    disposition,
    notes: null,
    vehiclePresent: null,
    occurredAt,
  };
}

const reps: Rep[] = [
  { id: 'rep_1', name: 'Setter', territoryId: null },
  { id: 'rep_2', name: 'Closer', territoryId: null },
];

describe('buildJourneys', () => {
  it('treats a later stage as implying the earlier ones', () => {
    // A door sold at the kerb never had an appointment_set visit. Without this
    // rule the Sold step would be wider than Booked, which is not a funnel.
    const journeys = buildJourneys([visit('p1', 'closed_sale', '2026-08-10T17:00:00.000Z')]);
    const journey = journeys.get('p1')!;

    expect(journey.knocked).toBeDefined();
    expect(journey.contacted).toBeDefined();
    expect(journey.booked).toBeDefined();
    expect(journey.showed).toBeDefined();
    expect(journey.sold).toBeDefined();
  });

  it('timestamps each stage at the first visit that reached it', () => {
    const journeys = buildJourneys([
      visit('p1', 'no_answer', '2026-08-01T17:00:00.000Z'),
      visit('p1', 'appointment_set', '2026-08-03T17:00:00.000Z'),
      visit('p1', 'appointment_set', '2026-08-05T17:00:00.000Z'),
    ]);
    const journey = journeys.get('p1')!;

    // The knock that opened the door, not the most recent one.
    expect(journey.knocked?.at).toBe('2026-08-01T17:00:00.000Z');
    // The booking that happened, not the second time somebody logged it.
    expect(journey.booked?.at).toBe('2026-08-03T17:00:00.000Z');
  });

  it('reads the latest visit by its clock, not by upload order', () => {
    // Offline uploads land out of order, so array position means nothing.
    const journeys = buildJourneys([
      visit('p1', 'not_interested', '2026-08-09T17:00:00.000Z'),
      visit('p1', 'closed_sale', '2026-08-10T17:00:00.000Z'),
    ]);
    const outOfOrder = buildJourneys([
      visit('p2', 'closed_sale', '2026-08-10T17:00:00.000Z'),
      visit('p2', 'not_interested', '2026-08-09T17:00:00.000Z'),
    ]);

    expect(stillAt(journeys.get('p1')!, 'sold')).toBe(true);
    expect(stillAt(outOfOrder.get('p2')!, 'sold')).toBe(true);
  });

  it('keeps a reversed sale in the flow but not in the standing count', () => {
    const journeys = buildJourneys([
      visit('p1', 'closed_sale', '2026-08-01T17:00:00.000Z'),
      visit('p1', 'not_interested', '2026-08-09T17:00:00.000Z'),
    ]);
    const journey = journeys.get('p1')!;

    expect(journey.sold).toBeDefined();
    expect(stillAt(journey, 'sold')).toBe(false);
    // The knock still happened, so the earlier stages still stand.
    expect(stillAt(journey, 'contacted')).toBe(true);
  });
});

describe('selectFunnel', () => {
  it('never widens as it descends', () => {
    const report = selectFunnel([
      visit('p1', 'no_answer', '2026-08-01T17:00:00.000Z'),
      visit('p2', 'interested', '2026-08-01T17:00:00.000Z'),
      visit('p3', 'appointment_set', '2026-08-01T17:00:00.000Z'),
      visit('p4', 'closed_sale', '2026-08-01T17:00:00.000Z'),
    ]);

    const doors = report.steps.map((s) => s.doors);
    expect(doors).toEqual([4, 3, 2, 1, 1]);
    for (let i = 1; i < doors.length; i++) {
      expect(doors[i]!).toBeLessThanOrEqual(doors[i - 1]!);
    }
  });

  it('counts a missed appointment as booked and not as showed', () => {
    // The whole reason the two dispositions exist. A no-show that dropped out
    // of Booked would hide the leak instead of measuring it.
    const report = selectFunnel([
      visit('p1', 'appointment_set', '2026-08-01T17:00:00.000Z'),
      visit('p1', 'appointment_missed', '2026-08-04T17:00:00.000Z'),
      visit('p2', 'appointment_set', '2026-08-01T17:00:00.000Z'),
      visit('p2', 'appointment_kept', '2026-08-04T17:00:00.000Z'),
    ]);

    const booked = report.steps.find((s) => s.stage === 'booked')!;
    const showed = report.steps.find((s) => s.stage === 'showed')!;
    expect(booked.doors).toBe(2);
    expect(showed.doors).toBe(1);
    expect(report.noShows).toBe(1);
    expect(report.showRate).toBe(0.5);
  });

  it('does not count a door that never booked as a no-show', () => {
    const report = selectFunnel([visit('p1', 'no_answer', '2026-08-01T17:00:00.000Z')]);
    expect(report.noShows).toBe(0);
    expect(report.showRate).toBeNull();
  });

  it('measures the median gap between stages, not the mean', () => {
    // One door that sat for months would drag an average past anything a
    // manager could act on.
    const report = selectFunnel([
      visit('p1', 'appointment_set', '2026-08-01T00:00:00.000Z'),
      visit('p1', 'appointment_kept', '2026-08-02T00:00:00.000Z'),
      visit('p2', 'appointment_set', '2026-08-01T00:00:00.000Z'),
      visit('p2', 'appointment_kept', '2026-08-03T00:00:00.000Z'),
      visit('p3', 'appointment_set', '2026-08-01T00:00:00.000Z'),
      visit('p3', 'appointment_kept', '2026-11-01T00:00:00.000Z'),
    ]);

    const showed = report.steps.find((s) => s.stage === 'showed')!;
    // 24h, 48h and roughly 2200h. The median is 48; the mean would be ~760.
    expect(showed.medianHoursFromPrevious).toBe(48);
  });

  it('reports an empty funnel rather than dividing by zero', () => {
    const report = selectFunnel([]);
    expect(report.steps.every((s) => s.doors === 0)).toBe(true);
    expect(report.steps.every((s) => s.stepConversion === 0)).toBe(true);
    expect(report.showRate).toBeNull();
  });
});

describe('selectRepStageCredit', () => {
  it('credits the setter with the booking and the closer with the sale', () => {
    // Counting every stage against whoever last touched the door is what makes
    // a good setter look idle.
    const rows = selectRepStageCredit(reps, [
      visit('p1', 'appointment_set', '2026-08-01T17:00:00.000Z', 'rep_1'),
      visit('p1', 'closed_sale', '2026-08-05T17:00:00.000Z', 'rep_2'),
    ]);

    const setter = rows.find((r) => r.repId === 'rep_1')!;
    const closer = rows.find((r) => r.repId === 'rep_2')!;

    expect(setter.booked).toBe(1);
    expect(setter.sold).toBe(0);
    expect(setter.passedOn).toBe(1);
    expect(closer.sold).toBe(1);
    // The closer did not book it and must not be credited with having done so.
    expect(closer.booked).toBe(0);
  });

  it('does not count a door as passed on when one rep did both', () => {
    const rows = selectRepStageCredit(reps, [
      visit('p1', 'appointment_set', '2026-08-01T17:00:00.000Z', 'rep_1'),
      visit('p1', 'closed_sale', '2026-08-05T17:00:00.000Z', 'rep_1'),
    ]);
    expect(rows.find((r) => r.repId === 'rep_1')!.passedOn).toBe(0);
  });

  it('drops a rep who has left the roster rather than inventing a row', () => {
    const rows = selectRepStageCredit(reps, [
      visit('p1', 'closed_sale', '2026-08-01T17:00:00.000Z', 'rep_gone'),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.sold === 0)).toBe(true);
  });
});

describe('selectStageDays', () => {
  it('cuts the day in the client timezone, not in UTC', () => {
    // 03:00 UTC on the 11th is 20:00 on the 10th in Riverside. Cut in UTC and
    // the crew's Monday total disagrees with the crew's own Monday.
    const zone = 'America/Los_Angeles';
    const iso = '2026-08-11T03:00:00.000Z';
    expect(zonedDayKey(iso, zone)).toBe('2026-08-10');

    const days = selectStageDays([visit('p1', 'no_answer', iso)], zone, [
      '2026-08-10',
      '2026-08-11',
    ]);
    expect(days.find((d) => d.dayKey === '2026-08-10')!.knocked).toBe(1);
    expect(days.find((d) => d.dayKey === '2026-08-11')!.knocked).toBe(0);
  });

  it('puts a door on the day it reached the stage, not the day it was knocked', () => {
    const days = selectStageDays(
      [
        visit('p1', 'appointment_set', '2026-08-10T18:00:00.000Z'),
        visit('p1', 'closed_sale', '2026-08-12T18:00:00.000Z'),
      ],
      'America/Los_Angeles',
      ['2026-08-10', '2026-08-11', '2026-08-12']
    );

    expect(days.find((d) => d.dayKey === '2026-08-10')!.booked).toBe(1);
    expect(days.find((d) => d.dayKey === '2026-08-10')!.sold).toBe(0);
    expect(days.find((d) => d.dayKey === '2026-08-12')!.sold).toBe(1);
  });

  it('returns a row for every requested day, including empty ones', () => {
    // A gap in the array would draw the chart's line straight through a day
    // nobody worked, which reads as work nobody did.
    const keys = recentDayKeys(7, 'America/Los_Angeles', new Date('2026-08-13T18:00:00.000Z'));
    const days = selectStageDays([], 'America/Los_Angeles', keys);
    expect(days).toHaveLength(keys.length);
    expect(days.map((d) => d.dayKey)).toEqual(keys);
  });
});

describe('selectVehicleSignal', () => {
  it('ignores knocks where the rep did not say', () => {
    // Treating "did not look" as "no car" would put most of the day in the
    // no-car row and make the signal look worthless.
    const withCar = { ...visit('p1', 'interested', '2026-08-01T17:00:00.000Z'), vehiclePresent: true };
    const withoutCar = { ...visit('p2', 'no_answer', '2026-08-01T17:00:00.000Z'), vehiclePresent: false };
    const unsaid = visit('p3', 'no_answer', '2026-08-01T17:00:00.000Z');

    const signal = selectVehicleSignal([withCar, withoutCar, unsaid]);

    expect(signal.observed).toBe(2);
    expect(signal.withCar.visits).toBe(1);
    expect(signal.withCar.contactRate).toBe(1);
    expect(signal.withoutCar.visits).toBe(1);
    expect(signal.withoutCar.contactRate).toBe(0);
  });

  it('reports a zero rate rather than dividing by zero', () => {
    const signal = selectVehicleSignal([visit('p1', 'no_answer', '2026-08-01T17:00:00.000Z')]);
    expect(signal.observed).toBe(0);
    expect(signal.withCar.contactRate).toBe(0);
  });
});
