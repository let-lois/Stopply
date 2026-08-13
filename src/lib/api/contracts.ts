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
import { MODULE_IDS } from '@/types/index';

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
  industry: z.string(),
  status: clientStatusSchema,
  plan: clientPlanSchema,
  dataMode: dataModeSchema,
  enabledModules: z.array(moduleIdSchema),
  integrations: z.array(integrationSchema),
  createdAt: isoDateTime,
  lastActive: isoDateTime,
  contactEmail: z.string(),
  contactName: z.string(),
});

export const clientsResponseSchema = z.object({ clients: z.array(clientSchema) });

export const setModuleRequestSchema = z.object({
  moduleId: moduleIdSchema,
  enabled: z.boolean(),
});

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export const teamResponseSchema = z.object({ users: z.array(sessionUserSchema) });

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditEntrySchema = z.object({
  id: z.string(),
  timestamp: isoDateTime,
  userId: z.string(),
  userName: z.string(),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  moduleId: moduleIdSchema.optional(),
  action: z.string(),
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
