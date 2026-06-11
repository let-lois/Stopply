// Contact upsert and touch handling shared by the webhook path and the
// pixel stitching path. First touch on a contact is frozen: once set, no
// webhook, sync, or re engagement may overwrite it. Latest touch always
// updates, and every touch appends a touchpoints row.

import type { TenantD1 } from '@letlois/tenant-d1';
import { emailNorm, nameNorm, phoneLast10 } from '@letlois/attribution';
import { randomToken } from '../crypto';

export interface TouchInfo {
  at: string;
  channel: string;
  source: string | null;
  campaign: string | null;
  json: Record<string, unknown>;
  sourceKey: string;
  eventId: string | null;
}

export interface ContactInput {
  externalRef: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  followupStage?: string | null;
  treatment?: string | null;
}

export interface ContactRowLite {
  id: string;
  email_norm: string | null;
  phone_last10: string | null;
  name_norm: string | null;
  visitor_id: string | null;
  first_touch_at: string | null;
}

export async function findContact(
  d1: TenantD1,
  databaseId: string,
  input: { externalRef?: string | null; email?: string | null; phone?: string | null; name?: string | null }
): Promise<ContactRowLite | null> {
  if (input.externalRef) {
    const { results } = await d1.query<ContactRowLite>(
      databaseId,
      `SELECT id, email_norm, phone_last10, name_norm, visitor_id, first_touch_at FROM contacts WHERE id = ?`,
      [input.externalRef]
    );
    if (results[0]) return results[0];
  }
  const email = emailNorm(input.email);
  if (email) {
    const { results } = await d1.query<ContactRowLite>(
      databaseId,
      `SELECT id, email_norm, phone_last10, name_norm, visitor_id, first_touch_at FROM contacts WHERE email_norm = ? LIMIT 1`,
      [email]
    );
    if (results[0]) return results[0];
  }
  const phone = phoneLast10(input.phone);
  if (phone) {
    const { results } = await d1.query<ContactRowLite>(
      databaseId,
      `SELECT id, email_norm, phone_last10, name_norm, visitor_id, first_touch_at FROM contacts WHERE phone_last10 = ? LIMIT 1`,
      [phone]
    );
    if (results[0]) return results[0];
  }
  const name = nameNorm(input.name);
  if (name) {
    const { results } = await d1.query<ContactRowLite>(
      databaseId,
      `SELECT id, email_norm, phone_last10, name_norm, visitor_id, first_touch_at FROM contacts WHERE name_norm = ? LIMIT 1`,
      [name]
    );
    if (results[0]) return results[0];
  }
  return null;
}

export async function upsertContact(
  d1: TenantD1,
  databaseId: string,
  input: ContactInput,
  touch: TouchInfo
): Promise<{ contactId: string; created: boolean }> {
  const fullName = `${input.firstName ?? ''} ${input.lastName ?? ''}`.trim();
  const existing = await findContact(d1, databaseId, {
    externalRef: input.externalRef,
    email: input.email,
    phone: input.phone,
    name: fullName || null,
  });

  if (existing) {
    // Latest touch always updates. First touch is frozen.
    await d1.query(
      databaseId,
      `UPDATE contacts SET
         email_norm = COALESCE(email_norm, ?),
         phone_last10 = COALESCE(phone_last10, ?),
         name_norm = COALESCE(name_norm, ?),
         latest_touch_at = ?, latest_touch_channel = ?, latest_touch_source = ?,
         latest_touch_campaign = ?, latest_touch_json = ?
       WHERE id = ?`,
      [
        emailNorm(input.email),
        phoneLast10(input.phone),
        nameNorm(fullName) ?? null,
        touch.at,
        touch.channel,
        touch.source,
        touch.campaign,
        JSON.stringify(touch.json),
        existing.id,
      ]
    );
    // Backfill a frozen first touch only when none exists yet.
    if (!existing.first_touch_at) {
      await d1.query(
        databaseId,
        `UPDATE contacts SET first_touch_at = ?, first_touch_channel = ?, first_touch_source = ?,
           first_touch_campaign = ?, first_touch_json = ?
         WHERE id = ? AND first_touch_at IS NULL`,
        [touch.at, touch.channel, touch.source, touch.campaign, JSON.stringify(touch.json), existing.id]
      );
    }
    await appendTouchpoint(d1, databaseId, existing.id, touch);
    return { contactId: existing.id, created: false };
  }

  const contactId = input.externalRef ?? `c_${randomToken(8)}`;
  await d1.query(
    databaseId,
    `INSERT OR IGNORE INTO contacts (id, email_norm, phone_last10, name_norm, first_name, last_name, created_at,
       first_touch_at, first_touch_channel, first_touch_source, first_touch_campaign, first_touch_json,
       latest_touch_at, latest_touch_channel, latest_touch_source, latest_touch_campaign, latest_touch_json,
       match_method, match_ambiguous)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      contactId,
      emailNorm(input.email),
      phoneLast10(input.phone),
      nameNorm(fullName),
      input.firstName,
      input.lastName,
      input.createdAt,
      touch.at,
      touch.channel,
      touch.source,
      touch.campaign,
      JSON.stringify(touch.json),
      touch.at,
      touch.channel,
      touch.source,
      touch.campaign,
      JSON.stringify(touch.json),
      input.externalRef ? 'external_ref' : 'created',
    ]
  );
  await appendTouchpoint(d1, databaseId, contactId, touch);
  return { contactId, created: true };
}

async function appendTouchpoint(
  d1: TenantD1,
  databaseId: string,
  contactId: string,
  touch: TouchInfo
): Promise<void> {
  await d1.query(
    databaseId,
    `INSERT INTO touchpoints (id, contact_id, occurred_at, channel, source_key, campaign, event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`tp_${randomToken(8)}`, contactId, touch.at, touch.channel, touch.sourceKey, touch.campaign, touch.eventId]
  );
}

// Visitor stitching: when a form submit or identify call carries an email
// or phone matching a contact, link the visitor and fold the visitor's
// first touch into the contact's first touch if the contact has none
// earlier.
export async function stitchVisitor(
  d1: TenantD1,
  databaseId: string,
  visitorId: string,
  identity: { email?: string | null; phone?: string | null }
): Promise<string | null> {
  const contact = await findContact(d1, databaseId, {
    email: identity.email,
    phone: identity.phone,
  });
  if (!contact) return null;

  await d1.query(databaseId, `UPDATE contacts SET visitor_id = COALESCE(visitor_id, ?) WHERE id = ?`, [
    visitorId,
    contact.id,
  ]);

  const { results } = await d1.query<{
    first_seen_at: string;
    first_landing_page: string | null;
    first_referrer: string | null;
    first_utm_json: string | null;
    first_click_ids_json: string | null;
  }>(databaseId, `SELECT * FROM visitors WHERE id = ?`, [visitorId]);
  const visitor = results[0];
  if (!visitor) return contact.id;

  // Fold the visitor first touch in only when the contact has no earlier
  // first touch. The frozen rule still holds: we only fill blanks or
  // replace with a strictly earlier touch context.
  if (!contact.first_touch_at || visitor.first_seen_at < contact.first_touch_at) {
    const utm = visitor.first_utm_json ? JSON.parse(visitor.first_utm_json) : {};
    const clicks = visitor.first_click_ids_json ? JSON.parse(visitor.first_click_ids_json) : {};
    await d1.query(
      databaseId,
      `UPDATE contacts SET first_touch_at = ?, first_touch_channel = COALESCE(?, first_touch_channel),
         first_touch_source = COALESCE(?, first_touch_source), first_touch_json = ?
       WHERE id = ? AND (first_touch_at IS NULL OR first_touch_at > ?)`,
      [
        visitor.first_seen_at,
        null,
        utm.source ?? null,
        JSON.stringify({
          landingPage: visitor.first_landing_page,
          referrer: visitor.first_referrer,
          utm,
          clickIds: clicks,
        }),
        contact.id,
        visitor.first_seen_at,
      ]
    );
  }
  return contact.id;
}
