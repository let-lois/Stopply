// Platform types.
//
// This file owns the vocabulary of the platform itself: clients, users,
// modules, audit, credential references. It does NOT own any module's domain
// types. Those live in src/modules/<name>/types.ts and are invisible from
// here, which the linter enforces.
//
// The prototype's equivalent barrel was imported for a type it did not export.
// esbuild strips type-only imports without resolving them, so the build passed
// while tsc failed, and with no CI nobody found out.

export type ModuleId =
  | 'advertising'
  | 'field_sales'
  | 'ecommerce'
  | 'logistics'
  | 'crm'
  | 'analytics';

export const MODULE_IDS: readonly ModuleId[] = [
  'advertising',
  'field_sales',
  'ecommerce',
  'logistics',
  'crm',
  'analytics',
] as const;

export type DataMode = 'demo' | 'live';

export type UserRole = 'super_admin' | 'client_admin' | 'manager' | 'representative';

export type IntegrationProvider =
  | 'meta'
  | 'google_ads'
  | 'shopify'
  | 'stripe'
  | 'field_maps'
  | 'carrier_api';

export interface IntegrationStatus {
  id: string;
  name: string;
  provider: IntegrationProvider;
  connected: boolean;
  /** Overrides the client-level mode for this integration's module. */
  dataMode: DataMode;
  /** ISO 8601. */
  lastSynced?: string;
  accountName?: string;
}

export type ClientStatus = 'active' | 'paused' | 'onboarding';
export type ClientPlan = 'Enterprise' | 'Pro' | 'Growth';

export interface Client {
  id: string;
  code: string;
  name: string;
  industry: string;
  status: ClientStatus;
  plan: ClientPlan;
  dataMode: DataMode;
  /** What this client has paid for. Enforced by ModuleGuard, and in Phase 2 by the server. */
  enabledModules: ModuleId[];
  integrations: IntegrationStatus[];
  /** ISO 8601. Every timestamp in this file is ISO 8601 and formatted at the render boundary. */
  createdAt: string;
  /** ISO 8601. */
  lastActive: string;
  contactEmail: string;
  contactName: string;
  /**
   * IANA zone. Reporting days are cut here, not in the reader's zone: a
   * manager in Arizona looking at a California crew would otherwise see the
   * day boundary move by an hour, and "knocked today" would disagree with the
   * crew's own count of their own day.
   */
  timezone: string;
  /**
   * The client's own mark, as a data URI, or null for the generated monogram.
   *
   * A workspace wears this instead of ours, which is the whole point: a client
   * opening their dashboard should see their company and not their agency's
   * software.
   */
  logo: string | null;
}

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /**
   * Null only for platform-wide roles. A client-scoped role without a client
   * is a user object no real backend could issue, which the prototype's role
   * switcher produced on every use.
   */
  clientId: string | null;
  clientName?: string;
  status: 'active' | 'invited' | 'inactive';
}

// A closed set, so the audit page can branch on it exhaustively. The
// prototype typed this as string and matched with action.includes('ENABLE').
export type AuditAction =
  | 'CREATE_CLIENT'
  | 'UPDATE_CLIENT'
  | 'ENABLE_MODULE'
  | 'DISABLE_MODULE'
  | 'SWITCH_DATA_MODE'
  | 'INTEGRATION_DATA_MODE'
  | 'LOG_VISIT'
  | 'ADD_PROPERTY'
  | 'ADD_CREDENTIAL'
  | 'REMOVE_CREDENTIAL'
  | 'CREATE_TERRITORY'
  | 'UPDATE_TERRITORY'
  | 'DELETE_TERRITORY'
  | 'ASSIGN_REP';

export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'CREATE_CLIENT',
  'UPDATE_CLIENT',
  'ENABLE_MODULE',
  'DISABLE_MODULE',
  'SWITCH_DATA_MODE',
  'INTEGRATION_DATA_MODE',
  'LOG_VISIT',
  'ADD_PROPERTY',
  'ADD_CREDENTIAL',
  'REMOVE_CREDENTIAL',
  'CREATE_TERRITORY',
  'UPDATE_TERRITORY',
  'DELETE_TERRITORY',
  'ASSIGN_REP',
] as const;

export interface AuditLogEntry {
  id: string;
  /** ISO 8601. */
  timestamp: string;
  userId: string;
  userName: string;
  clientId?: string;
  clientName?: string;
  moduleId?: ModuleId;
  action: AuditAction;
  details: string;
  /**
   * Set by the server from CF-Connecting-IP.
   *
   * Phase 1 had no such field: client-side code cannot obtain an address, and
   * the prototype declared it and left it empty forever. It is here now
   * because there is finally something that can fill it in.
   */
  ipAddress?: string;
}

/**
 * A reference to a credential, never the credential.
 *
 * The name is load-bearing. This type must never be able to hold a secret
 * value, and there is no code path in this application that accepts, stores,
 * transmits, or displays one. `last4` is a display affordance and is the most
 * that ever leaves the server.
 */
export interface CredentialRef {
  id: string;
  clientId: string;
  clientName: string;
  provider: string;
  keyName: string;
  last4: string;
  /** ISO 8601. */
  updatedAt: string;
  status: 'active' | 'revoked' | 'expired';
}
