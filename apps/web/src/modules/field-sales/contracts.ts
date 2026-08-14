// The field-sales wire contract.
//
// It lives inside the module rather than in src/lib/api/contracts.ts because
// the ownership rule in §3 says a module owns its domain, and this is that
// domain crossing a network instead of a function call. The server imports it,
// the live adapter imports it, and both are checked against the same
// definition in the same tsc run.

import { z } from 'zod';

export const dispositionSchema = z.enum([
  'not_visited',
  'no_answer',
  'come_back',
  'not_interested',
  'interested',
  'appointment_set',
  'appointment_kept',
  'appointment_missed',
  'closed_sale',
  'do_not_knock',
]);

/** A drawn ring, [lng, lat], in the order it was drawn. */
export const ringSchema = z
  .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .min(3)
  .max(500);

export const territoryWireSchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * Derived from the boundary on every write, never edited on its own. The map
   * frames itself with it; nothing decides membership with it.
   */
  bounds: z.object({
    north: z.number(),
    south: z.number(),
    east: z.number(),
    west: z.number(),
  }),
  /** Null only for a territory that predates shapes and was never backfilled. */
  boundary: ringSchema.nullable(),
  /**
   * Every rep working this territory.
   *
   * Plural, and derived from reps.territory_id, which is the column field
   * scoping actually reads. The old single assignedRepId was a second copy of
   * the same fact pointing the other way, and the two could disagree.
   */
  repIds: z.array(z.string()),
});

export const saveTerritoryRequestSchema = z.object({
  name: z.string().min(1).max(80),
  boundary: ringSchema,
});

export const assignRepRequestSchema = z.object({
  /** Null takes the rep off any territory, which is how a new hire starts. */
  territoryId: z.string().nullable(),
});

export const territoriesResponseSchema = z.object({
  territories: z.array(territoryWireSchema),
  /** How many doors each territory holds, so a manager can see the split. */
  doorCounts: z.record(z.string(), z.number()),
});

export const repWireSchema = z.object({
  id: z.string(),
  name: z.string(),
  territoryId: z.string().nullable(),
});

export const propertyWireSchema = z.object({
  id: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  lat: z.number(),
  lng: z.number(),
  territoryId: z.string(),
  disposition: dispositionSchema,
  ownerName: z.string().nullable(),
  ownerPhone: z.string().nullable(),
  notes: z.string().nullable(),
});

export const visitWireSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  repId: z.string(),
  disposition: dispositionSchema,
  notes: z.string().nullable(),
  /** Null means the rep did not say, which is not the same as no car. */
  vehiclePresent: z.boolean().nullable(),
  occurredAt: z.string(),
});

export const fieldSalesDataSchema = z.object({
  properties: z.array(propertyWireSchema),
  visits: z.array(visitWireSchema),
  territories: z.array(territoryWireSchema),
  reps: z.array(repWireSchema),
});

/**
 * Logging a knock.
 *
 * `deviceVisitId` is minted on the device, before the knock is uploaded, and
 * is the entire offline story. The rep keeps working out of signal, the
 * outbox retries whenever it can, and the server recognises a knock it has
 * already recorded by this id rather than by guessing from a timestamp.
 *
 * `occurredAt` is the device's clock at the door. It is deliberately not
 * derived from arrival time: a knock uploaded hours later belongs on the day
 * it happened, and reporting reads this field.
 */
export const logVisitRequestSchema = z.object({
  deviceVisitId: z.string().min(8).max(64),
  propertyId: z.string().min(1),
  /**
   * Who knocked.
   *
   * Sent by the dashboard, where a manager logs on a rep's behalf. The rep
   * app omits it and the server takes the rep from the session instead: a
   * phone must not be able to attribute a knock to a colleague.
   */
  repId: z.string().min(1).optional(),
  disposition: dispositionSchema,
  notes: z.string().max(2000).nullable(),
  /** Optional: a rep who did not look must not be recorded as seeing no car. */
  vehiclePresent: z.boolean().nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
});

export const logVisitResponseSchema = z.object({
  visit: visitWireSchema,
  /**
   * True when this knock was already recorded.
   *
   * It is a 200, not a 4xx, and that is not a detail. The device's outbox
   * retries until it gets a success, so answering a resend with an error
   * means the outbox never drains and the rep's phone retries the same knock
   * forever. Never change this to an error response.
   */
  duplicate: z.boolean(),
});

// ---------------------------------------------------------------------------
// The rep app
// ---------------------------------------------------------------------------

export const fieldLoginRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(400),
  turnstileToken: z.string().max(2048).optional(),
});

export const fieldSessionSchema = z.object({
  repId: z.string(),
  repName: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  /**
   * The employer's mark, so the rep app wears it too.
   *
   * A rep is the client's staff, not ours, and the phone in their hand is the
   * most visible piece of this product. Defaulted rather than required so a
   * phone running an older build against a newer server still validates.
   */
  clientLogo: z.string().nullable().default(null),
  territoryName: z.string().nullable(),
});

/**
 * What a rep's phone holds.
 *
 * Their own territory's doors and nothing else: no other rep's day, no
 * client-wide reporting, no dispositions belonging to another workspace. The
 * whole payload is scoped from the session row, so there is no request a rep
 * can craft that widens it.
 */
export const fieldDoorsSchema = z.object({
  session: fieldSessionSchema,
  properties: z.array(propertyWireSchema),
  /** Only this rep's own recent knocks, for the day's tally. */
  visits: z.array(visitWireSchema),
});
