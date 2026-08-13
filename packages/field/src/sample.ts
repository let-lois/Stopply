// Sample door to door activity.
//
// Exists so a client can see their reporting working before their crew has
// knocked anything. An empty dashboard teaches nobody how to read it, and
// "trust us, it fills in later" is a bad way to hand over a build.
//
// Two rules shape everything below. The numbers have to be believable, or
// the client learns to read a funnel that does not behave like theirs: most
// doors go unanswered, sales are rare, and reps differ from each other.
// And every row has to be marked as sample, so removing it later cannot
// take a real knock with it.

import { addressKey } from './address';
import { DEFAULT_DISPOSITIONS } from './dispositions';

// Deterministic PRNG. The same seed gives the same week of activity, which
// keeps the reporting tests meaningful and means a regenerated demo does
// not silently become a different demo.
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (const ch of seed) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export interface SampleRep {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: 'rep' | 'manager';
  team: string;
}

export interface SampleAddress {
  id: string;
  addressKey: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lng: number;
}

export interface SampleVisit {
  id: string;
  clientUuid: string;
  addressId: string;
  repId: string;
  disposition: string;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  occurredAt: string;
  followUpAt: string | null;
}

export interface SampleData {
  reps: SampleRep[];
  addresses: SampleAddress[];
  visits: SampleVisit[];
}

// Sample identities are obviously not real people, so nobody mistakes a
// demo row for a customer record or tries to phone one.
const REP_NAMES = [
  ['Dana Reyes', 'manager'],
  ['Marcus Hill', 'rep'],
  ['Priya Nair', 'rep'],
  ['Tyler Boone', 'rep'],
  ['Alex Rios', 'rep'],
] as const;

const STREETS = [
  'N Sycamore St',
  'E Palm Ln',
  'W Cactus Rd',
  'S Ironwood Dr',
  'N Mesquite Way',
  'E Saguaro Blvd',
  'W Ocotillo Rd',
  'S Juniper Ct',
  'N Agave Trl',
  'E Mariposa St',
];

const NOTE_POOL: Record<string, string[]> = {
  no_answer: ['Nobody home, no car in the drive', 'Lights off, try evening', 'Dog barking, no answer'],
  come_back: ['Asked to come back after 6', 'Eating dinner, try tomorrow', 'Said stop by Saturday'],
  not_interested: ['Just had it done last year', 'Not interested, closed the door', 'Said no thanks'],
  not_qualified: ['Roof too new', 'Outside the service area', 'HOA handles it'],
  renter: ['Renting, owner lives out of state', 'Tenant, gave the landlord number'],
  callback: ['Wants a call Monday morning', 'Asked for pricing by phone'],
  appointment: ['Booked for Thursday 6pm, both owners home', 'Set for Saturday 10am'],
  sale: ['Signed on the spot', 'Closed, financing approved'],
  do_not_knock: ['Asked not to be contacted again', 'Requested removal from the route'],
};

const FIRST_NAMES = ['Jordan', 'Casey', 'Morgan', 'Riley', 'Avery', 'Quinn', 'Sky', 'Rowan'];
const LAST_NAMES = ['Carter', 'Diaz', 'Fletcher', 'Osei', 'Nakamura', 'Bell', 'Ivanov', 'Achebe'];

// The disposition mix. Weighted the way a real day goes: most doors reach
// nobody, and a sale is uncommon enough that knocks-per-sale lands in a
// range a manager would recognise rather than a flattering one.
const WEIGHTS: Array<[string, number]> = [
  ['no_answer', 46],
  ['come_back', 12],
  ['not_interested', 18],
  ['not_qualified', 6],
  ['renter', 5],
  ['callback', 6],
  ['appointment', 5],
  ['sale', 1.5],
  ['do_not_knock', 0.5],
];

function pickDisposition(random: () => number): string {
  const total = WEIGHTS.reduce((n, [, w]) => n + w, 0);
  let roll = random() * total;
  for (const [key, weight] of WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return 'no_answer';
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] as T;
}

export interface SampleOptions {
  // Anchors the generated window. Passed in rather than read from the clock
  // so the caller controls it and tests stay deterministic.
  now: Date;
  days?: number;
  seed?: string;
  // Roughly where the crew is working. Only used to place coordinates so
  // the nearby lookup and any mapping have something plausible to show.
  centerLat?: number;
  centerLng?: number;
  city?: string;
  state?: string;
  postalCode?: string;
}

// Builds a window of activity ending today.
//
// Reps work weekdays and Saturdays, with nothing on Sundays, because a
// chart with a flat seven day rhythm looks generated. Each rep has a
// slightly different volume and closing habit for the same reason: a
// leaderboard where everyone is identical demonstrates nothing.
export function buildSampleData(options: SampleOptions): SampleData {
  const days = Math.min(Math.max(options.days ?? 30, 1), 120);
  const seed = options.seed ?? 'stopply-field-sample';
  const random = rng(seed);
  const city = options.city ?? 'Mesa';
  const state = options.state ?? 'AZ';
  const postalCode = options.postalCode ?? '85201';
  const centerLat = options.centerLat ?? 33.4152;
  const centerLng = options.centerLng ?? -111.8315;

  const reps: SampleRep[] = REP_NAMES.map(([name, role], i) => ({
    id: `fr_sample_${i + 1}`,
    email: `${name.toLowerCase().split(' ')[0]}.sample@example.invalid`,
    name,
    phone: `480-555-01${String(10 + i).slice(-2)}`,
    role,
    team: i < 3 ? 'Team A' : 'Team B',
  }));

  // A block of houses: even numbers down one side of each street.
  const addresses: SampleAddress[] = [];
  for (let s = 0; s < STREETS.length; s++) {
    const street = STREETS[s] as string;
    for (let n = 0; n < 14; n++) {
      const number = 100 + s * 100 + n * 2;
      const line = `${number} ${street}`;
      addresses.push({
        id: `fa_sample_${s}_${n}`,
        addressKey: addressKey({ street: line, city, state, postalCode }),
        street: line,
        city,
        state,
        postalCode,
        // Streets run east to west, houses step along them, so the points
        // cluster into rows the way a worked neighbourhood actually does.
        lat: centerLat + s * 0.0016,
        lng: centerLng + n * 0.0011,
      });
    }
  }

  const knownDispositions = new Set(DEFAULT_DISPOSITIONS.map((d) => d.key));
  const visits: SampleVisit[] = [];
  let counter = 0;

  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(options.now.getTime() - d * 86400000);
    // Sunday off.
    if (day.getUTCDay() === 0) continue;
    const saturday = day.getUTCDay() === 6;

    for (const [index, rep] of reps.entries()) {
      // Managers knock less: they are running the crew.
      const base = rep.role === 'manager' ? 14 : 26;
      const appetite = base * (0.75 + index * 0.09);
      const count = Math.round(appetite * (saturday ? 0.6 : 1) * (0.7 + random() * 0.6));

      // A rep walks a route in order, so their knocks march forward through
      // the day rather than landing at random hours. Beyond realism this is
      // what keeps do-not-knock honest: with random times a house could end
      // up knocked at 6pm and asked to be left alone at 10am on the same
      // day, which is the one thing this data must never show.
      let minuteOfDay = 9 * 60 + Math.floor(random() * 30);

      for (let k = 0; k < count; k++) {
        // The day ends. A rep does not knock past dark.
        if (minuteOfDay > 19 * 60) break;
        // Time advances whether or not this door gets logged, the same way
        // walking to a house nobody is home at still costs the rep minutes.
        minuteOfDay += 5 + Math.floor(random() * 25);

        const address = pick(random, addresses);
        const disposition = pickDisposition(random);
        if (!knownDispositions.has(disposition)) continue;

        const occurred = new Date(
          Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            Math.floor(minuteOfDay / 60),
            minuteOfDay % 60
          )
        );

        const isLead = disposition === 'callback' || disposition === 'appointment' || disposition === 'sale';
        const contactName = isLead ? `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)}` : null;
        const notes = random() < 0.45 ? pick(random, NOTE_POOL[disposition] ?? ['']) || null : null;

        counter++;
        visits.push({
          id: `fv_sample_${counter}`,
          clientUuid: `sample-${seed}-${counter}`,
          addressId: address.id,
          repId: rep.id,
          disposition,
          notes,
          contactName,
          contactPhone: contactName ? `480-555-${String(1000 + (counter % 9000)).slice(-4)}` : null,
          contactEmail: null,
          occurredAt: occurred.toISOString(),
          followUpAt:
            disposition === 'appointment' || disposition === 'callback'
              ? new Date(occurred.getTime() + (1 + Math.floor(random() * 5)) * 86400000).toISOString()
              : null,
        });
      }
    }
  }

  // Do-not-knock, enforced in one chronological pass over the finished set.
  //
  // It cannot be done while generating: reps are generated one after
  // another but their days overlap, so a rep produced later can mark a
  // house at 9:30 that an earlier rep had already been given at 10:00. The
  // only way to be sure no visit lands after a household asked to be left
  // alone is to decide it in time order, once, at the end.
  const chronological = [...visits].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const closed = new Set<string>();
  const kept: SampleVisit[] = [];
  for (const visit of chronological) {
    if (closed.has(visit.addressId)) continue;
    if (visit.disposition === 'do_not_knock') closed.add(visit.addressId);
    kept.push(visit);
  }

  // Only the doors that were actually visited, so coverage numbers are not
  // inflated by a block nobody walked.
  const touched = new Set(kept.map((v) => v.addressId));
  return {
    reps,
    addresses: addresses.filter((a) => touched.has(a.id)),
    visits: kept,
  };
}
