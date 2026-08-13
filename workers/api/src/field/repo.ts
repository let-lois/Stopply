// Tenant database access for door to door field tracking.
//
// The one genuinely hard requirement here is that recording a visit is safe
// to repeat. Reps work where signal is bad; the app queues visits on the
// phone and retries them, sometimes hours later, sometimes more than once
// for the same knock. Every write below is keyed on the client_uuid the
// phone minted before the visit was ever sent, so a retry converges on the
// same row instead of inflating the day's numbers.

import { dispositionFromRow, normalizeAddress, type Disposition } from '@letlois/field';
import type { TenantD1 } from '@letlois/tenant-d1';
import { randomToken } from '../crypto';

export interface VisitInput {
  clientUuid: string;
  street: string;
  unit?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  disposition: string;
  notes?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  occurredAt: string;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  followUpAt?: string | null;
}

export interface RecordedVisit {
  id: string;
  addressId: string;
  // True when this client_uuid had already been recorded. The phone treats
  // it exactly like a success and clears the visit from its outbox, which
  // is the whole point: a retry must never be able to fail permanently.
  duplicate: boolean;
}

interface AddressRow {
  id: string;
  lat: number | null;
  lng: number | null;
  do_not_knock: number;
}

export async function loadDispositions(d1: TenantD1, dbId: string): Promise<Disposition[]> {
  const { results } = await d1.query<Parameters<typeof dispositionFromRow>[0]>(
    dbId,
    `SELECT key, label, sort_order, is_contact, is_lead, is_appointment, is_sale,
       marks_do_not_knock, color, active
     FROM field_dispositions ORDER BY sort_order, label`
  );
  return results.map(dispositionFromRow);
}

// Finds or creates the row for a physical address. Coordinates from the
// first visit that carried them are kept: a later knock logged from
// indoors with a poor fix should not move a door that was already placed.
async function upsertAddress(
  d1: TenantD1,
  dbId: string,
  input: VisitInput
): Promise<AddressRow> {
  const norm = normalizeAddress({
    street: input.street,
    unit: input.unit,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
  });

  const select = async (): Promise<AddressRow | null> => {
    const { results } = await d1.query<AddressRow>(
      dbId,
      `SELECT id, lat, lng, do_not_knock FROM field_addresses WHERE address_key = ?`,
      [norm.key]
    );
    return results[0] ?? null;
  };

  const existing = await select();
  if (existing) {
    // Backfill coordinates only where there were none.
    if (existing.lat === null && input.lat != null && input.lng != null) {
      await d1.query(
        dbId,
        `UPDATE field_addresses SET lat = ?, lng = ? WHERE id = ? AND lat IS NULL`,
        [input.lat, input.lng, existing.id]
      );
    }
    return existing;
  }

  const id = `fa_${randomToken(8)}`;
  await d1.query(
    dbId,
    `INSERT OR IGNORE INTO field_addresses
       (id, address_key, street, unit, city, state, postal_code, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      norm.key,
      norm.street,
      norm.unit,
      norm.city,
      norm.state,
      norm.postalCode,
      input.lat ?? null,
      input.lng ?? null,
    ]
  );
  // Re-read rather than assuming the insert won: two reps can knock the
  // same door in the same second, and OR IGNORE makes the loser silent.
  const settled = await select();
  if (!settled) throw new Error('field address could not be resolved');
  return settled;
}

export async function recordVisit(
  d1: TenantD1,
  dbId: string,
  repId: string,
  input: VisitInput,
  dispositions: Map<string, Disposition>
): Promise<RecordedVisit> {
  const already = await d1.query<{ id: string; address_id: string }>(
    dbId,
    `SELECT id, address_id FROM field_visits WHERE client_uuid = ?`,
    [input.clientUuid]
  );
  const prior = already.results[0];
  if (prior) return { id: prior.id, addressId: prior.address_id, duplicate: true };

  const address = await upsertAddress(d1, dbId, input);
  const id = `fv_${randomToken(8)}`;

  await d1.query(
    dbId,
    `INSERT OR IGNORE INTO field_visits
       (id, client_uuid, address_id, rep_id, disposition, notes, contact_name, contact_phone,
        contact_email, occurred_at, device_lat, device_lng, accuracy_m, follow_up_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'field-app')`,
    [
      id,
      input.clientUuid,
      address.id,
      repId,
      input.disposition,
      input.notes ?? null,
      input.contactName ?? null,
      input.contactPhone ?? null,
      input.contactEmail ?? null,
      input.occurredAt,
      input.lat ?? null,
      input.lng ?? null,
      input.accuracyM ?? null,
      input.followUpAt ?? null,
    ]
  );

  const settled = await d1.query<{ id: string }>(
    dbId,
    `SELECT id FROM field_visits WHERE client_uuid = ?`,
    [input.clientUuid]
  );
  const settledId = settled.results[0]?.id;
  if (!settledId) throw new Error('field visit could not be recorded');
  // Another request carrying the same client_uuid got there first. Its
  // counter bump already happened, so this one must not repeat it.
  if (settledId !== id) return { id: settledId, addressId: address.id, duplicate: true };

  await bumpAddress(d1, dbId, address.id, input, dispositions);
  return { id, addressId: address.id, duplicate: false };
}

// Address rollup after a genuinely new visit.
//
// visit_count always increments, but the "latest" fields only move forward.
// Offline visits arrive out of order all the time: a phone that regained
// signal uploads Tuesday's knock after Wednesday's, and the door's current
// state must stay Wednesday's.
async function bumpAddress(
  d1: TenantD1,
  dbId: string,
  addressId: string,
  input: VisitInput,
  dispositions: Map<string, Disposition>
): Promise<void> {
  await d1.query(
    dbId,
    `UPDATE field_addresses
       SET visit_count = visit_count + 1,
           first_visited_at = CASE
             WHEN first_visited_at IS NULL OR first_visited_at > ? THEN ? ELSE first_visited_at END
     WHERE id = ?`,
    [input.occurredAt, input.occurredAt, addressId]
  );
  await d1.query(
    dbId,
    `UPDATE field_addresses SET last_visited_at = ?, last_disposition = ?
     WHERE id = ? AND (last_visited_at IS NULL OR last_visited_at <= ?)`,
    [input.occurredAt, input.disposition, addressId, input.occurredAt]
  );

  // Do not knock is sticky and never rolls back, whatever order the visits
  // land in. A household that asked to be left alone stays that way even if
  // an older, friendlier knock uploads afterwards.
  if (dispositions.get(input.disposition)?.marksDoNotKnock) {
    await d1.query(dbId, `UPDATE field_addresses SET do_not_knock = 1 WHERE id = ?`, [addressId]);
  }
}

export interface VisitRow {
  id: string;
  client_uuid: string;
  address_id: string;
  rep_id: string;
  rep_name: string | null;
  disposition: string;
  notes: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  occurred_at: string;
  recorded_at: string;
  follow_up_at: string | null;
  edited_at: string | null;
  street: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  do_not_knock: number;
}

const VISIT_SELECT = `SELECT v.id, v.client_uuid, v.address_id, v.rep_id, r.name AS rep_name,
    v.disposition, v.notes, v.contact_name, v.contact_phone, v.contact_email,
    v.occurred_at, v.recorded_at, v.follow_up_at, v.edited_at,
    a.street, a.unit, a.city, a.state, a.postal_code, a.lat, a.lng, a.do_not_knock
  FROM field_visits v
  JOIN field_addresses a ON a.id = v.address_id
  LEFT JOIN field_reps r ON r.id = v.rep_id`;

export async function listVisits(
  d1: TenantD1,
  dbId: string,
  opts: { repId?: string; from?: string; to?: string; disposition?: string; limit: number }
): Promise<VisitRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.repId) (where.push('v.rep_id = ?'), params.push(opts.repId));
  if (opts.from) (where.push('v.occurred_at >= ?'), params.push(opts.from));
  if (opts.to) (where.push('v.occurred_at <= ?'), params.push(opts.to));
  if (opts.disposition) (where.push('v.disposition = ?'), params.push(opts.disposition));
  const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const { results } = await d1.query<VisitRow>(
    dbId,
    `${VISIT_SELECT}${clause} ORDER BY v.occurred_at DESC LIMIT ?`,
    [...params, opts.limit]
  );
  return results;
}

// Facts for the reporting aggregators. Kept to the columns the pure
// functions read so a wide date range stays cheap to pull.
export async function listVisitFacts(
  d1: TenantD1,
  dbId: string,
  opts: { from: string; to: string; repId?: string; limit?: number }
): Promise<Array<{ id: string; repId: string; repName: string | null; addressId: string; disposition: string; occurredAt: string }>> {
  const params: unknown[] = [opts.from, opts.to];
  let clause = 'WHERE v.occurred_at >= ? AND v.occurred_at <= ?';
  if (opts.repId) {
    clause += ' AND v.rep_id = ?';
    params.push(opts.repId);
  }
  const { results } = await d1.query<{
    id: string;
    rep_id: string;
    rep_name: string | null;
    address_id: string;
    disposition: string;
    occurred_at: string;
  }>(
    dbId,
    `SELECT v.id, v.rep_id, r.name AS rep_name, v.address_id, v.disposition, v.occurred_at
     FROM field_visits v LEFT JOIN field_reps r ON r.id = v.rep_id
     ${clause} ORDER BY v.occurred_at DESC LIMIT ?`,
    [...params, opts.limit ?? 20000]
  );
  return results.map((r) => ({
    id: r.id,
    repId: r.rep_id,
    repName: r.rep_name,
    addressId: r.address_id,
    disposition: r.disposition,
    occurredAt: r.occurred_at,
  }));
}
