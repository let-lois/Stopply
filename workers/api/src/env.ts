import type { SessionRecord, TenantRow } from '@letlois/db';

export interface Env {
  CONTROL_DB: D1Database;
  ASSETS: R2Bucket;
  CSV_BUCKET: R2Bucket;
  SESSIONS: KVNamespace;
  AGENCY_HOST: string;
  TENANT_HOST_SUFFIX: string;
  // Secrets, set via wrangler secret put. Never logged, never serialized.
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_ID: string;
  CRED_MASTER_KEY: string;
  ANTHROPIC_API_KEY: string;
  INGEST_PEPPER: string;
}

// A session that belongs to the dashboard population. contextMiddleware
// refuses to store a field rep's session under `session`, so every route
// reading it can rely on the user being an agency or tenant user without
// re-checking, and audit entries keep their existing actor types.
export type DashboardSession = SessionRecord & { userType: 'agency' | 'tenant' };

export function isDashboardSession(s: SessionRecord | null): s is DashboardSession {
  return s !== null && s.userType !== 'field';
}

export interface RequestVars {
  session: DashboardSession | null;
  sessionToken: string | null;
  // The door to door rep signed in to the field app, from its own cookie.
  // Never populated from the dashboard cookie and never readable as one.
  fieldSession: SessionRecord | null;
  fieldToken: string | null;
  // How that field session arrived. The standalone store app sends a bearer
  // token because a cookie cannot cross into its WebView origin; the web
  // field app still sends the cookie. CSRF applies to one and not the other.
  fieldAuth: 'cookie' | 'bearer' | null;
  // Tenant resolved from the hostname, or from the agency switcher.
  tenant: TenantRow | null;
  hostContext: 'agency' | 'tenant';
}

export type AppContext = {
  Bindings: Env;
  Variables: RequestVars;
};
