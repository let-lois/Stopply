// Every field-sales number the dashboard shows, derived from visits and
// properties. Nothing here is stored.
//
// The prototype hand-incremented five counters when a visit was logged, and
// the result was wrong in five different ways at once: propertiesVisited,
// conversionRate, revenue and the entire disposition breakdown were never
// updated at all, so the chart sat frozen at its seed values; re-logging a
// closed sale incremented the sale count again; moving a property from
// Interested to Not Interested neither incremented nor decremented, so the
// interested count only ever grew; and territory coverage never responded to
// a new property.
//
// All of it was derivable. Selectors live in the module rather than in lib/
// because they operate on this module's types, which platform code may not
// see. This is the highest-value test surface in the application.

import type { Property, PropertyDisposition, Rep, Territory, Visit } from '@/modules/field-sales/types';
import { buildJourneys, stillAt } from '@/modules/field-sales/funnel';

/**
 * Dispositions that count as having reached a person.
 *
 * appointment_kept is one: somebody opened the door for the appointment.
 * appointment_missed is not, and that is the point of separating them. A rep
 * who drives out to a booked appointment and finds nobody home has had no
 * conversation, and counting it as one would make a crew's contact rate climb
 * every time an appointment fell through.
 */
const CONTACT_DISPOSITIONS: ReadonlySet<PropertyDisposition> = new Set([
  'not_interested',
  'interested',
  'appointment_set',
  'appointment_kept',
  'closed_sale',
  'do_not_knock',
]);

/**
 * A household that has expressed interest, whatever happened afterwards.
 *
 * appointment_missed stays in. They booked; the appointment is what failed,
 * not the lead. Dropping it here would mean a no-show quietly removed a lead
 * from the pipeline, which is the opposite of what a manager needs to see.
 */
const LEAD_DISPOSITIONS: ReadonlySet<PropertyDisposition> = new Set([
  'interested',
  'appointment_set',
  'appointment_kept',
  'appointment_missed',
  'closed_sale',
]);

export const DISPOSITION_LABELS: Record<PropertyDisposition, string> = {
  not_visited: 'Not visited',
  no_answer: 'No answer',
  come_back: 'Come back later',
  not_interested: 'Not interested',
  interested: 'Interested',
  appointment_set: 'Appointment set',
  appointment_kept: 'Showed',
  appointment_missed: 'No-show',
  closed_sale: 'Closed sale',
  do_not_knock: 'Do not knock',
};

export interface FieldKpis {
  /** Every visit logged. A house knocked three times is three. */
  visitsLogged: number;
  /** Distinct properties with at least one visit. The same house is one. */
  propertiesVisited: number;
  totalProperties: number;
  contacts: number;
  /** Doors sitting at Interested right now, still waiting on a booking. */
  interestedLeads: number;
  /** Doors that ever booked, including ones that have since shown or sold. */
  appointmentsSet: number;
  /** Doors that booked and turned up. */
  appointmentsKept: number;
  /** Doors that booked and did not. The leak, as a number. */
  noShows: number;
  salesClosed: number;
  /** Share of visits that reached a person. */
  contactRate: number;
  /** Share of conversations that closed. Measured against contacts, not
   *  knocks: a rep controls how many doors they knock, not who is home. */
  conversionRate: number;
  coveragePct: number;
}

export function selectKpis(properties: Property[], visits: Visit[]): FieldKpis {
  const visitedPropertyIds = new Set(visits.map((v) => v.propertyId));

  let contacts = 0;
  for (const visit of visits) {
    if (CONTACT_DISPOSITIONS.has(visit.disposition)) contacts++;
  }

  // Interested is a current state: these are the doors still waiting on a
  // booking, so a door that has since booked correctly leaves the count.
  let interestedLeads = 0;
  for (const property of properties) {
    if (property.disposition === 'interested') interestedLeads++;
  }

  // Bookings and sales are cumulative, and read from the journey rather than
  // from current dispositions. Counting current dispositions meant a door that
  // booked and then showed left appointment_set, so "appointments set" fell
  // every time an appointment went well. Per-door and once, so re-logging a
  // sale still cannot inflate anything.
  const journeys = buildJourneys(visits);
  let appointmentsSet = 0;
  let appointmentsKept = 0;
  let salesClosed = 0;
  for (const journey of journeys.values()) {
    if (journey.booked) appointmentsSet++;
    if (journey.showed) appointmentsKept++;
    // Standing, not cumulative, and deliberately the one number here that is.
    // A sale re-dispositioned afterwards did happen, and the funnel counts the
    // flow, but this card is what a manager reads as "we have this many sales"
    // and it must not include one that was reversed.
    if (stillAt(journey, 'sold')) salesClosed++;
  }

  return {
    visitsLogged: visits.length,
    propertiesVisited: visitedPropertyIds.size,
    totalProperties: properties.length,
    contacts,
    interestedLeads,
    appointmentsSet,
    appointmentsKept,
    noShows: appointmentsSet - appointmentsKept,
    salesClosed,
    contactRate: visits.length > 0 ? contacts / visits.length : 0,
    conversionRate: contacts > 0 ? salesClosed / contacts : 0,
    coveragePct: properties.length > 0 ? visitedPropertyIds.size / properties.length : 0,
  };
}

export interface DispositionSlice {
  disposition: PropertyDisposition;
  label: string;
  count: number;
  share: number;
}

/** The breakdown the prototype froze at its seed values. */
export function selectDispositionBreakdown(properties: Property[]): DispositionSlice[] {
  const counts = new Map<PropertyDisposition, number>();
  for (const property of properties) {
    counts.set(property.disposition, (counts.get(property.disposition) ?? 0) + 1);
  }

  const total = properties.length;
  return (Object.keys(DISPOSITION_LABELS) as PropertyDisposition[])
    .map((disposition) => {
      const count = counts.get(disposition) ?? 0;
      return {
        disposition,
        label: DISPOSITION_LABELS[disposition],
        count,
        share: total > 0 ? count / total : 0,
      };
    })
    .filter((slice) => slice.count > 0);
}

export interface TerritoryCoverage {
  territoryId: string;
  name: string;
  totalProperties: number;
  visitedProperties: number;
  coveragePct: number;
  assignedRepNames: string[];
}

export function selectTerritoryCoverage(
  territories: Territory[],
  properties: Property[],
  visits: Visit[],
  reps: Rep[]
): TerritoryCoverage[] {
  const visitedPropertyIds = new Set(visits.map((v) => v.propertyId));
  const repsById = new Map(reps.map((r) => [r.id, r]));

  return territories.map((territory) => {
    const owned = properties.filter((p) => p.territoryId === territory.id);
    const visited = owned.filter((p) => visitedPropertyIds.has(p.id)).length;
    return {
      territoryId: territory.id,
      name: territory.name,
      totalProperties: owned.length,
      visitedProperties: visited,
      coveragePct: owned.length > 0 ? visited / owned.length : 0,
      // Every rep on the territory, not one. The single assignedRepId this
      // replaces was a second copy of reps.territoryId pointing the other
      // way, and the two could disagree about who was working an area.
      assignedRepNames: territory.repIds
        .map((id) => repsById.get(id)?.name)
        .filter((name): name is string => Boolean(name)),
    };
  });
}

export interface RepPerformance {
  repId: string;
  repName: string;
  visits: number;
  contacts: number;
  sales: number;
  contactRate: number;
}

export function selectRepPerformance(
  reps: Rep[],
  visits: Visit[],
  properties: Property[]
): RepPerformance[] {
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  return reps
    .map((rep) => {
      const own = visits.filter((v) => v.repId === rep.id);
      const contacts = own.filter((v) => CONTACT_DISPOSITIONS.has(v.disposition)).length;
      // A sale is counted from the property's current state, so a rep whose
      // sale was later reversed does not keep credit for it.
      const sales = own.filter(
        (v) => propertyById.get(v.propertyId)?.disposition === 'closed_sale'
      ).length;
      return {
        repId: rep.id,
        repName: rep.name,
        visits: own.length,
        contacts,
        sales,
        contactRate: own.length > 0 ? contacts / own.length : 0,
      };
    })
    .sort((a, b) => b.sales - a.sales || b.visits - a.visits);
}

export function isLead(disposition: PropertyDisposition): boolean {
  return LEAD_DISPOSITIONS.has(disposition);
}
