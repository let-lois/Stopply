// The outcome vocabulary and what each outcome means to reporting.
//
// The dashboard never asks "is this disposition key 'sale'". It asks the
// catalog whether the outcome counts as a contact, a lead, an appointment,
// or a sale. That indirection is what lets a tenant rename "Appointment
// set" to "Demo booked", or add an outcome of their own, without the funnel
// silently losing a stage.

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

// Mirrors the seed rows in migration 0006. Kept here so the field app and
// the reporting tab can render a sane catalog before the API answers, and
// so tests have a fixture that cannot drift from the migration silently.
export const DEFAULT_DISPOSITIONS: Disposition[] = [
  d('no_answer', 'No answer', 10, {}, '#8b97a8'),
  d('come_back', 'Come back later', 20, {}, '#c7902f'),
  d('not_interested', 'Not interested', 30, { isContact: true }, '#c7502f'),
  d('not_qualified', 'Not qualified', 40, { isContact: true }, '#8b97a8'),
  d('renter', 'Renter, not the decision maker', 50, { isContact: true }, '#8b97a8'),
  d('callback', 'Callback scheduled', 60, { isContact: true, isLead: true }, '#1f7ae0'),
  d(
    'appointment',
    'Appointment set',
    70,
    { isContact: true, isLead: true, isAppointment: true },
    '#6f5ad6'
  ),
  d(
    'sale',
    'Sale closed',
    80,
    { isContact: true, isLead: true, isAppointment: true, isSale: true },
    '#1f9d6b'
  ),
  d('do_not_knock', 'Do not knock', 90, { isContact: true, marksDoNotKnock: true }, '#211d16'),
];

function d(
  key: string,
  label: string,
  sortOrder: number,
  flags: Partial<Pick<Disposition, 'isContact' | 'isLead' | 'isAppointment' | 'isSale' | 'marksDoNotKnock'>>,
  color: string
): Disposition {
  return {
    key,
    label,
    sortOrder,
    isContact: flags.isContact ?? false,
    isLead: flags.isLead ?? false,
    isAppointment: flags.isAppointment ?? false,
    isSale: flags.isSale ?? false,
    marksDoNotKnock: flags.marksDoNotKnock ?? false,
    color,
    active: true,
  };
}

// Database rows arrive as integers from SQLite. One place converts.
export function dispositionFromRow(row: {
  key: string;
  label: string;
  sort_order: number;
  is_contact: number;
  is_lead: number;
  is_appointment: number;
  is_sale: number;
  marks_do_not_knock: number;
  color: string | null;
  active: number;
}): Disposition {
  return {
    key: row.key,
    label: row.label,
    sortOrder: Number(row.sort_order),
    isContact: row.is_contact === 1,
    isLead: row.is_lead === 1,
    isAppointment: row.is_appointment === 1,
    isSale: row.is_sale === 1,
    marksDoNotKnock: row.marks_do_not_knock === 1,
    color: row.color,
    active: row.active === 1,
  };
}

export function dispositionIndex(dispositions: Disposition[]): Map<string, Disposition> {
  return new Map(dispositions.map((x) => [x.key, x]));
}
