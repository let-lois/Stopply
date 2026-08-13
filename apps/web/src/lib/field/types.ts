// Shapes the field app exchanges with /api/field.

export interface Disposition {
  key: string;
  label: string;
  sortOrder: number;
  isContact: boolean;
  isLead: boolean;
  isAppointment: boolean;
  isSale: boolean;
  marksDoNotKnock: boolean;
  color: string | null;
  active: boolean;
}

export interface FieldRep {
  id: string;
  name: string;
  email: string;
  role: 'rep' | 'manager';
  team: string | null;
}

export interface FieldBootstrap {
  rep: FieldRep;
  tenant: { name: string; slug: string; timezone: string };
  dispositions: Disposition[];
  csrf: string;
}

// A visit as the app holds it, before and after it reaches the server.
// clientUuid is minted on the phone and is the identity that survives every
// retry.
export interface QueuedVisit {
  clientUuid: string;
  street: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  disposition: string;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  occurredAt: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  followUpAt: string | null;
}

export interface OutboxEntry {
  visit: QueuedVisit;
  attempts: number;
  lastError: string | null;
  // Set once the server has rejected the visit for a reason retrying cannot
  // fix. The rep is shown these rather than having them disappear.
  rejected: boolean;
}

export interface SavedVisit {
  id: string;
  clientUuid: string;
  addressId: string;
  address: string;
  street: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  disposition: string;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  occurredAt: string;
  followUpAt: string | null;
}

export interface NearbyAddress {
  id: string;
  address: string;
  street: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  lastDisposition: string | null;
  lastVisitedAt: string | null;
  visitCount: number;
  doNotKnock: boolean;
}

export interface FieldTotals {
  visits: number;
  doors: number;
  contacts: number;
  leads: number;
  appointments: number;
  sales: number;
  contactRate: number;
  leadRate: number;
  closeRate: number;
  knocksPerSale: number | null;
}

export interface FieldStats {
  today: FieldTotals;
  week: FieldTotals;
  team?: FieldTotals;
}
