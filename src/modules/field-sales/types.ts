// Door to door. The reference module: it is the one the prototype wired
// correctly, and the only one whose behaviour was honest.

export type PropertyDisposition =
  | 'not_visited'
  | 'no_answer'
  | 'come_back'
  | 'not_interested'
  | 'interested'
  | 'appointment_set'
  | 'closed_sale'
  | 'do_not_knock';

export interface Territory {
  id: string;
  name: string;
  /** The extent the map projects against. Real coordinates, actually read. */
  bounds: { north: number; south: number; east: number; west: number };
  assignedRepId: string | null;
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
