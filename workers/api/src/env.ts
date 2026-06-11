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

export interface RequestVars {
  session: SessionRecord | null;
  sessionToken: string | null;
  // Tenant resolved from the hostname, or from the agency switcher.
  tenant: TenantRow | null;
  hostContext: 'agency' | 'tenant';
}

export type AppContext = {
  Bindings: Env;
  Variables: RequestVars;
};
