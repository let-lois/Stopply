// Door to door. The reference module: it is the one the prototype wired
// correctly, and the only one whose behaviour was honest.

/**
 * The outcomes this app defines itself.
 *
 * A closed union, and deliberately still one: it is what keeps the compiler
 * checking that a built-in outcome added here also gets a rank and a colour in
 * catalog.ts. That check has already earned its keep once, on the two
 * appointment outcomes below.
 */
export type BuiltinDisposition =
  | 'not_visited'
  | 'no_answer'
  | 'come_back'
  | 'not_interested'
  | 'interested'
  | 'appointment_set'
  // Two outcomes, not one, because a booking nobody turned up to and a booking
  // that has not happened yet were indistinguishable without them, and the gap
  // between booked and showed is where this business leaks.
  | 'appointment_kept'
  | 'appointment_missed'
  | 'closed_sale'
  | 'do_not_knock';

/**
 * The outcome recorded at a door, as a key into whichever catalog is in force.
 *
 * Open, not the union above. When the data comes from the BI platform the set
 * of outcomes belongs to the client: they can rename "Sold" or add "Left a
 * quote", and a closed union here would make a real disposition
 * unrepresentable. What a key means is the catalog's answer rather than the
 * type system's, which is the whole point of catalog.ts.
 */
export type PropertyDisposition = string;

export interface Territory {
  id: string;
  name: string;
  /** Derived from `boundary` on write. An index for framing, not a definition. */
  bounds: { north: number; south: number; east: number; west: number };
  /** The ring a manager drew, [lng, lat]. */
  boundary: Array<[number, number]> | null;
  /** Every rep on this territory, derived from reps.territoryId. */
  repIds: string[];
}

export interface Rep {
  id: string;
  name: string;
  territoryId: string | null;
}

export interface Property {
  id: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lng: number;
  territoryId: string;
  disposition: PropertyDisposition;
  ownerName: string | null;
  ownerPhone: string | null;
  notes: string | null;
}

export interface Visit {
  id: string;
  propertyId: string;
  repId: string;
  disposition: PropertyDisposition;
  notes: string | null;
  /**
   * A car on the drive.
   *
   * Null means the rep did not say, which is not the same as saying there was
   * none. It is the best signal that somebody is home and it is what decides
   * which no-answers are worth a second pass.
   */
  vehiclePresent: boolean | null;
  /** ISO 8601. */
  occurredAt: string;
}

/**
 * The slice the shared provider holds.
 *
 * Exported deliberately and by name: this is the one place a module's shape
 * is visible to state outside it, and making that explicit is what stops it
 * happening incidentally everywhere else.
 */
export interface FieldSalesSlice {
  properties: Property[];
  visits: Visit[];
  territories: Territory[];
  reps: Rep[];
}

export type FieldSalesData = FieldSalesSlice;
