// The funnel a door moves through, derived from the visit log.
//
// Knocked, contacted, booked, showed, sold. The question this answers is not
// "how many doors are currently at each outcome" but "how many got this far",
// and those are different numbers. A door that books an appointment and then
// shows leaves appointment_set, so counting current dispositions makes the
// booked total fall every time an appointment goes well. That is what the
// dashboard did before this file existed, and it is the wrong direction.
//
// So a stage is reached once and stays reached. The visit log holds when, and
// who, which is what makes setter-versus-closer attribution possible: the rep
// credited with a booking is the one whose knock recorded it, not whoever
// happened to close the sale weeks later.
//
// A later stage implies the earlier ones. A door sold at the kerb with no
// appointment counts as booked, timestamped at the same visit. The alternative
// is a funnel where a stage can be wider than the one above it, which is not a
// funnel. This is stated rather than hidden: the ladder below is the whole
// definition.

import type { Rep, Visit } from '@/modules/field-sales/types';
import { BUILTIN_CATALOG, type DispositionCatalog } from '@/modules/field-sales/catalog';
import { zonedDayKey } from '@/lib/format/zonedDay';

export const FUNNEL_STAGES = ['knocked', 'contacted', 'booked', 'showed', 'sold'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const STAGE_LABELS: Record<FunnelStage, string> = {
  knocked: 'Knocked',
  contacted: 'Contacted',
  booked: 'Booked',
  showed: 'Showed',
  sold: 'Sold',
};

/**
 * How far up the ladder each outcome reaches, from the catalog in force.
 *
 * This was a hardcoded Record keyed by outcome name. It is a catalog lookup
 * now because the BI platform lets a client rename an outcome or add one, and
 * a rank keyed by name loses the stage the moment somebody does. See
 * catalog.ts: the platform's ranks are derived from its is_contact /
 * is_appointment / is_sale flags, so an outcome called anything at all still
 * lands on the right rung.
 *
 * The two judgement calls that used to live here are still written down, in
 * the catalog beside the outcomes they apply to: do_not_knock counts as
 * contacted, and appointment_missed counts as booked but no further.
 */

export interface StageReach {
  /** ISO 8601 of the first visit that got the door this far. */
  at: string;
  /** The rep on that visit. Booked is the setter; sold is the closer. */
  repId: string;
}

/** When each door first reached each stage, and who took it there. */
export type PropertyJourney = Partial<Record<FunnelStage, StageReach>> & {
  /**
   * How far the door stands right now, from its most recent visit.
   *
   * Separate from the stages above because reaching a stage and still being
   * there are different facts and both are wanted. A door sold in March and
   * re-dispositioned to not_interested in April did reach sold, so the funnel
   * still counts the flow, but it is not a standing sale and the headline
   * count of sales must not say it is.
   */
  currentRank: number;
};

/**
 * Build every door's journey from the visits.
 *
 * Earliest visit wins per stage, so a door knocked five times is credited to
 * the knock that actually moved it rather than the most recent one.
 */
export function buildJourneys(
  visits: Visit[],
  catalog: DispositionCatalog = BUILTIN_CATALOG
): Map<string, PropertyJourney> {
  const journeys = new Map<string, PropertyJourney>();
  const latest = new Map<string, string>();

  for (const visit of visits) {
    const rank = catalog.rankOf(visit.disposition);
    if (rank === 0) continue;

    let journey = journeys.get(visit.propertyId);
    if (!journey) {
      journey = { currentRank: 0 };
      journeys.set(visit.propertyId, journey);
    }

    // Every stage up to and including this visit's rank, which is where the
    // "a later stage implies the earlier ones" rule is actually applied.
    for (let i = 0; i < rank && i < FUNNEL_STAGES.length; i++) {
      const stage = FUNNEL_STAGES[i]!;
      const held = journey[stage];
      if (!held || visit.occurredAt < held.at) {
        journey[stage] = { at: visit.occurredAt, repId: visit.repId };
      }
    }

    // Latest by the clock at the door, not by the order the visits arrived.
    // Offline uploads land out of order, so array position means nothing.
    const held = latest.get(visit.propertyId);
    if (!held || visit.occurredAt >= held) {
      latest.set(visit.propertyId, visit.occurredAt);
      journey.currentRank = rank;
    }
  }

  return journeys;
}

/** Whether the door still stands at this stage, rather than merely reached it. */
export function stillAt(journey: PropertyJourney, stage: FunnelStage): boolean {
  return journey.currentRank >= FUNNEL_STAGES.indexOf(stage) + 1;
}

export interface FunnelStep {
  stage: FunnelStage;
  label: string;
  doors: number;
  /** Share of the doors that reached the stage above. 1 for knocked. */
  stepConversion: number;
  /** Share of all knocked doors. */
  overallConversion: number;
  /**
   * Median hours from the previous stage, over the doors that made both.
   *
   * Median rather than mean: one door that sat for three months would drag an
   * average past anything a manager could act on, and the question being asked
   * is "how long does this normally take".
   */
  medianHoursFromPrevious: number | null;
}

export interface FunnelReport {
  steps: FunnelStep[];
  /** Doors that booked and then failed to show. The leak, named. */
  noShows: number;
  /** Share of booked appointments that were kept. Null with none booked. */
  showRate: number | null;
  /**
   * Doors still standing as sold.
   *
   * Lower than the Sold step when a sale was later re-dispositioned. The two
   * numbers are both true and mean different things, so the view says so when
   * they differ rather than quietly showing whichever is larger.
   */
  standingSold: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The funnel over a set of visits.
 *
 * Takes visits rather than a date range: the caller has already cut the window
 * in the client's zone, and taking both would let this function and the caller
 * disagree about which knocks are in it.
 *
 * A door is counted in a stage if it reached it, whenever that was, from the
 * visits handed in. Narrow the visits to narrow the funnel.
 */
export function selectFunnel(
  visits: Visit[],
  catalog: DispositionCatalog = BUILTIN_CATALOG
): FunnelReport {
  const journeys = buildJourneys(visits, catalog);
  const all = [...journeys.values()];

  const steps: FunnelStep[] = [];
  const knocked = all.filter((j) => j.knocked).length;

  FUNNEL_STAGES.forEach((stage, index) => {
    const reached = all.filter((j) => j[stage]);
    const previous = index === 0 ? null : FUNNEL_STAGES[index - 1]!;
    const previousCount = previous ? all.filter((j) => j[previous]).length : reached.length;

    const gaps = previous
      ? reached
          .filter((j) => j[previous])
          .map(
            (j) =>
              (new Date(j[stage]!.at).getTime() - new Date(j[previous]!.at).getTime()) / 3600000
          )
      : [];

    steps.push({
      stage,
      label: STAGE_LABELS[stage],
      doors: reached.length,
      stepConversion: previousCount > 0 ? reached.length / previousCount : 0,
      overallConversion: knocked > 0 ? reached.length / knocked : 0,
      medianHoursFromPrevious: median(gaps),
    });
  });

  const booked = all.filter((j) => j.booked).length;
  const showed = all.filter((j) => j.showed).length;

  return {
    steps,
    noShows: booked - showed,
    showRate: booked > 0 ? showed / booked : null,
    standingSold: all.filter((j) => stillAt(j, 'sold')).length,
  };
}

export interface RepStageCredit {
  repId: string;
  repName: string;
  knocked: number;
  contacted: number;
  /** Set by this rep. The setter half of the pair. */
  booked: number;
  showed: number;
  /** Closed by this rep, which is frequently not the rep who booked it. */
  sold: number;
  /** Doors this rep booked that somebody else closed. */
  passedOn: number;
}

/**
 * Who did what, stage by stage.
 *
 * Credit goes to the rep on the visit that first reached the stage, so a
 * setter keeps their booking when a closer finishes the sale, and a closer is
 * not credited with a booking they inherited. Counting every stage against
 * whoever last touched the door is what makes a good setter look idle.
 */
export function selectRepStageCredit(reps: Rep[], visits: Visit[]): RepStageCredit[] {
  const journeys = buildJourneys(visits);
  const rows = new Map<string, RepStageCredit>(
    reps.map((rep) => [
      rep.id,
      {
        repId: rep.id,
        repName: rep.name,
        knocked: 0,
        contacted: 0,
        booked: 0,
        showed: 0,
        sold: 0,
        passedOn: 0,
      },
    ])
  );

  for (const journey of journeys.values()) {
    for (const stage of FUNNEL_STAGES) {
      const reach = journey[stage];
      if (!reach) continue;
      const row = rows.get(reach.repId);
      // A visit by a rep who has since left the roster still happened. It is
      // dropped from the per-rep table rather than attributed to nobody,
      // because a row with no name is not something a manager can use.
      if (row) row[stage]++;
    }

    const setter = journey.booked?.repId;
    const closer = journey.sold?.repId;
    if (setter && closer && setter !== closer) {
      const row = rows.get(setter);
      if (row) row.passedOn++;
    }
  }

  return [...rows.values()].sort((a, b) => b.sold - a.sold || b.booked - a.booked);
}

export interface StageDay {
  dayKey: string;
  knocked: number;
  booked: number;
  showed: number;
  sold: number;
}

/**
 * Each stage per day, cut in the client's zone.
 *
 * A door appears on the day it reached the stage, not the day it was knocked,
 * so the showed line moves when appointments are kept rather than trailing the
 * knocks that created them.
 */
export function selectStageDays(visits: Visit[], timeZone: string, dayKeys: string[]): StageDay[] {
  const journeys = buildJourneys(visits);
  const byDay = new Map<string, StageDay>(
    dayKeys.map((dayKey) => [dayKey, { dayKey, knocked: 0, booked: 0, showed: 0, sold: 0 }])
  );

  for (const journey of journeys.values()) {
    for (const stage of ['knocked', 'booked', 'showed', 'sold'] as const) {
      const reach = journey[stage];
      if (!reach) continue;
      // Only days the caller asked for. A door that reached a stage outside
      // the window is simply not on the chart, which is the same rule the
      // headline totals use because both read the same day-keys.
      const row = byDay.get(zonedDayKey(reach.at, timeZone));
      if (row) row[stage]++;
    }
  }

  return dayKeys.map((dayKey) => byDay.get(dayKey)!);
}

/**
 * How often a car on the drive meant somebody answered.
 *
 * Only over knocks where the rep actually said. Treating "did not look" as
 * "no car" would put most of the day in the no-car row and make the signal
 * look worthless.
 */
export function selectVehicleSignal(
  visits: Visit[],
  catalog: DispositionCatalog = BUILTIN_CATALOG
): {
  observed: number;
  withCar: { visits: number; contacts: number; contactRate: number };
  withoutCar: { visits: number; contacts: number; contactRate: number };
} {
  const contacted = (v: Visit) => catalog.rankOf(v.disposition) >= 2;
  const withCar = visits.filter((v) => v.vehiclePresent === true);
  const withoutCar = visits.filter((v) => v.vehiclePresent === false);

  const summarize = (rows: Visit[]) => {
    const contacts = rows.filter(contacted).length;
    return {
      visits: rows.length,
      contacts,
      contactRate: rows.length > 0 ? contacts / rows.length : 0,
    };
  };

  return {
    observed: withCar.length + withoutCar.length,
    withCar: summarize(withCar),
    withoutCar: summarize(withoutCar),
  };
}
