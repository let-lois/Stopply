// Zod schemas for everything that crosses the localStorage boundary.
//
// The prototype cast JSON.parse(saved) straight to Client[]. Anything in that
// key, from a stale shape after a deploy to a hand-edited value, became a
// typed object the whole app then trusted. Every read here is validated, and
// a failure falls back to seed data rather than throwing into render.

import { z } from 'zod';

export const moduleIdSchema = z.enum([
  'advertising',
  'field_sales',
  'ecommerce',
  'logistics',
  'crm',
  'analytics',
]);

export const dataModeSchema = z.enum(['demo', 'live']);

export const integrationStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(['meta', 'google_ads', 'shopify', 'stripe', 'field_maps', 'carrier_api']),
  connected: z.boolean(),
  dataMode: dataModeSchema,
  lastSynced: z.iso.datetime().optional(),
  accountName: z.string().optional(),
});

export const clientSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  industry: z.string(),
  status: z.enum(['active', 'paused', 'onboarding']),
  plan: z.enum(['Enterprise', 'Pro', 'Growth']),
  dataMode: dataModeSchema,
  enabledModules: z.array(moduleIdSchema),
  integrations: z.array(integrationStatusSchema),
  createdAt: z.iso.datetime(),
  lastActive: z.iso.datetime(),
  contactEmail: z.string(),
  contactName: z.string(),
});

export const auditActionSchema = z.enum([
  'CREATE_CLIENT',
  'UPDATE_CLIENT',
  'ENABLE_MODULE',
  'DISABLE_MODULE',
  'SWITCH_DATA_MODE',
  'INTEGRATION_DATA_MODE',
  'LOG_VISIT',
  'ADD_PROPERTY',
]);

export const auditLogEntrySchema = z.object({
  id: z.string(),
  timestamp: z.iso.datetime(),
  userId: z.string(),
  userName: z.string(),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  moduleId: moduleIdSchema.optional(),
  action: auditActionSchema,
  details: z.string(),
});

// Field-sales persisted shapes. Deliberately structural rather than imported
// from the module: persistence is a wire format and must be able to reject a
// shape the current code would otherwise accept by inference.
const dispositionSchema = z.enum([
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

export const propertySchema = z.object({
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

export const visitSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  repId: z.string(),
  disposition: dispositionSchema,
  notes: z.string().nullable(),
  // Defaulted rather than required, because visits written by a build from
  // before this field existed are already in people's browsers. Requiring it
  // would fail the whole record and silently throw their demo work away.
  vehiclePresent: z.boolean().nullable().default(null),
  occurredAt: z.iso.datetime(),
});

export const clientsPayloadSchema = z.array(clientSchema);

// Field work is stored per client rather than as one flat list. A rep's day
// belongs to a workspace, and switching workspace must not lose it.
export const propertiesByClientSchema = z.record(z.string(), z.array(propertySchema));
export const visitsByClientSchema = z.record(z.string(), z.array(visitSchema));
export const auditPayloadSchema = z.array(auditLogEntrySchema);
export const propertiesPayloadSchema = z.array(propertySchema);
export const visitsPayloadSchema = z.array(visitSchema);
export const currentClientIdSchema = z.string().nullable();

export type PersistedClient = z.infer<typeof clientSchema>;
export type PersistedAuditEntry = z.infer<typeof auditLogEntrySchema>;
export type PersistedProperty = z.infer<typeof propertySchema>;
export type PersistedVisit = z.infer<typeof visitSchema>;
