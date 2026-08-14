// The wire.
//
// One file, imported by the server that produces these shapes and by the
// client that consumes them. §11.9 asks for Zod at both boundaries, and the
// only way that means anything is if both boundaries validate against the
// same schema: two hand-kept copies drift, and the drift shows up as a
// runtime error in a browser rather than a failure in CI.
//
// Because server/ and src/ are one TypeScript project, changing a shape here
// breaks both sides in the same `tsc` run.

import { z } from 'zod';
import { AUDIT_ACTIONS, MODULE_IDS } from '@/types/index';
import type { AuditAction } from '@/types/index';

const isoDateTime = z.string().datetime({ offset: true });

export const moduleIdSchema = z.enum(
  MODULE_IDS as unknown as [string, ...string[]]
) as z.ZodType<(typeof MODULE_IDS)[number]>;

export const userRoleSchema = z.enum(['super_admin', 'client_admin', 'manager', 'representative']);
export const dataModeSchema = z.enum(['demo', 'live']);
export const clientStatusSchema = z.enum(['active', 'paused', 'onboarding']);
export const clientPlanSchema = z.enum(['Enterprise', 'Pro', 'Growth']);
export const integrationProviderSchema = z.enum([
  'meta',
  'google_ads',
  'shopify',
  'stripe',
  'field_maps',
  'carrier_api',
]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginRequestSchema = z.object({
  email: z.string().email().max(320),
  // Bounded, because the hash is deliberately expensive and an unbounded
  // input is an unbounded amount of work for an unauthenticated caller.
  password: z.string().min(1).max(400),
  // Optional in the schema, required in fact. A request with no token must be
  // refused by the challenge, as a 403, rather than by validation as a 400:
  // "you did not pass the challenge" is the true reason, and it is the answer
  // a tokenless caller should get whether the field is absent or empty.
  turnstileToken: z.string().max(2048).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  clientId: z.string().nullable(),
  clientName: z.string().optional(),
  status: z.enum(['active', 'invited', 'inactive']),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  /**
   * Which clients this session may touch, resolved on the server.
   *
   * Null means every client, which only a super_admin gets. The client uses
   * this to decide what to draw; the server does not consult it at all, it
   * recomputes scope from the session on every request.
   */
  clientIds: z.array(z.string()).nullable(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const integrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: integrationProviderSchema,
  connected: z.boolean(),
  dataMode: dataModeSchema,
  lastSynced: isoDateTime.optional(),
  accountName: z.string().optional(),
});

export const clientSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  /**
   * Optional, because not every backend records one.
   *
   * This app's own server asks for an industry when a workspace is created.
   * The BI platform has no such column, and writing a plausible one in on its
   * behalf would put a guess on screen as though the client had told us.
   * Empty is the honest answer, and the places that show it drop the field
   * rather than render a dangling separator.
   */
  industry: z.string().default(''),
  status: clientStatusSchema,
  /**
   * The billing plan, as the backend spells it.
   *
   * Not an enum here, though it still is one on the create request below. The
   * difference is deliberate: what this app offers when it creates a workspace
   * is ours to enumerate, but what an existing workspace is already on is not.
   * The BI platform's vocabulary is its own, and validating a real client's
   * real plan against our list would reject it for being unfamiliar.
   */
  plan: z.string(),
  dataMode: dataModeSchema,
  enabledModules: z.array(moduleIdSchema),
  integrations: z.array(integrationSchema),
  createdAt: isoDateTime,
  /**
   * Null when the backend does not track it.
   *
   * The BI platform records when a workspace was created and not when anyone
   * last used it. Passing created_at off as last activity would show "active 5
   * months ago" for a client whose crew knocked doors this morning, which is
   * worse than showing nothing.
   */
  lastActive: isoDateTime.nullable().default(null),
  contactEmail: z.string().default(''),
  contactName: z.string().default(''),
  /**
   * IANA zone, the one this client's days are cut in.
   *
   * Defaulted rather than required so a response from a deploy that predates
   * the column still validates. The default matches the column's, so the two
   * cannot answer differently for the same client.
   */
  timezone: z.string().default('America/Los_Angeles'),
  /**
   * The client's own mark, as a data URI, or null to draw the monogram.
   *
   * Defaulted rather than required so a response from a deploy that predates
   * the column still validates. That is not hypothetical here: shipping a
   * required field before the reader that understands it is exactly what took
   * the Canvass page down earlier.
   */
  logo: z.string().nullable().default(null),
});

/**
 * Setting a workspace's mark.
 *
 * Null clears it and returns the workspace to its monogram, which is why this
 * is nullable rather than a separate delete route.
 */
export const setClientLogoRequestSchema = z.object({
  logo: z.string().max(200_000).nullable(),
});

export const clientsResponseSchema = z.object({ clients: z.array(clientSchema) });

export const setModuleRequestSchema = z.object({
  moduleId: moduleIdSchema,
  enabled: z.boolean(),
});

export const setDataModeRequestSchema = z.object({
  dataMode: dataModeSchema,
});

export const createClientRequestSchema = z.object({
  name: z.string().min(1).max(120),
  industry: z.string().min(1).max(120),
  code: z.string().min(2).max(8),
  plan: clientPlanSchema,
  status: clientStatusSchema,
  contactName: z.string().max(120),
  contactEmail: z.string().max(320),
  enabledModules: z.array(moduleIdSchema),
});

export const createClientResponseSchema = z.object({ client: clientSchema });

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export const teamResponseSchema = z.object({ users: z.array(sessionUserSchema) });

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditActionSchema = z.enum(
  AUDIT_ACTIONS as unknown as [string, ...string[]]
) as z.ZodType<AuditAction>;

export const auditEntrySchema = z.object({
  id: z.string(),
  timestamp: isoDateTime,
  userId: z.string(),
  userName: z.string(),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  moduleId: moduleIdSchema.optional(),
  // The closed set, not a string. Both sides share this file, so the server
  // cannot record an action the audit page has no branch for: it would fail
  // to compile rather than render as a blank row.
  action: auditActionSchema,
  details: z.string(),
  /**
   * Set by the server from CF-Connecting-IP, or absent.
   *
   * Phase 1 dropped this field because client-side code cannot obtain one and
   * the prototype declared it and never filled it in. It returns here because
   * there is now something that can actually populate it.
   */
  ipAddress: z.string().optional(),
});

export const auditResponseSchema = z.object({ entries: z.array(auditEntrySchema) });

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * What a credential looks like from outside the server.
 *
 * There is no `value` here, and there is no schema in this file that has one
 * on a response. The only place a secret appears in any contract is the
 * request below, travelling in exactly one direction.
 */
export const credentialRefSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  provider: z.string(),
  keyName: z.string(),
  last4: z.string(),
  updatedAt: isoDateTime,
  status: z.enum(['active', 'revoked', 'expired']),
});

export const credentialsResponseSchema = z.object({
  credentials: z.array(credentialRefSchema),
});

export const createCredentialRequestSchema = z.object({
  clientId: z.string().min(1),
  provider: z.string().min(1).max(64),
  keyName: z.string().min(1).max(120),
  /**
   * The only secret-bearing field in this file.
   *
   * It is write-only by construction: nothing in any response schema can hold
   * it, so there is no shape for a leak to travel in.
   */
  value: z.string().min(8).max(4096),
  /** Optional in the schema, refused by the challenge. See loginRequestSchema. */
  turnstileToken: z.string().max(2048).optional(),
});

export const createCredentialResponseSchema = z.object({
  credential: credentialRefSchema,
});
