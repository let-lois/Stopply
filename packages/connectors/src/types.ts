// The connectors framework. Each connector implements the same surface;
// the engine and UI never special case a provider. Connectors write
// canonical stage events through the db interface and the rollup engine
// does the rest.

export interface ConnectorDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
}

export interface ConnectorRequirements {
  provider: string;
  displayName: string;
  authKind: 'api_key' | 'oauth2';
  credentialFields: Array<{ key: string; label: string; secret: boolean }>;
  planRequirement: string;
  planLink: string;
  tokenGuide: string[];
  defaultStageMap: Array<{ externalEvent: string; stage: 'lead' | 'scheduled' | 'completed' | 'purchase' }>;
}

export interface TestConnectionResult {
  ok: boolean;
  // bad_credentials: the key or token is wrong or revoked.
  // insufficient_plan: the account authenticated but the plan lacks API access.
  // error: network or unexpected failure.
  failure?: 'bad_credentials' | 'insufficient_plan' | 'error';
  connectedAs?: string;
  planCheck?: Record<string, unknown>;
  message?: string;
}

export interface SyncStats {
  scheduled: number;
  completed: number;
  purchases: number;
  clientRecords: number;
}

// Ad-spend connectors (Meta, Apple Maps, eventually Google) sync spend/lead rows
// instead of CRM stage events, so "scheduled/completed/purchases" would
// be meaningless zeros for them - this is the stats shape they report.
export interface AdSyncStats {
  adSpendRows: number;
  adLineItemRows: number;
  // Months besides the one synced whose figures this sync changed (an ad
  // account change purges history), which the caller must roll up again.
  alsoChanged?: string[];
  // True when the connection now reports on something new, so the history
  // backfill should run again for it.
  restartBackfill?: boolean;
}

// Failures worth retrying on the next scheduled run without anybody acting:
// the platform was busy or unreachable, not wrong. Everything else needs a
// person, so the integration is marked failing until somebody fixes it.
export const TRANSIENT_FAILURES = ['rate_limited', 'server', 'network'] as const;

export function isTransientFailure(err: unknown): boolean {
  const failure = err && typeof err === 'object' ? (err as { failure?: unknown }).failure : undefined;
  return typeof failure === 'string' && (TRANSIENT_FAILURES as readonly string[]).includes(failure);
}

export interface ConnectorContext {
  fetchImpl?: typeof fetch;
  // Injected by tests so retries and token expiry run without real waiting.
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  // True when the caller is LetLois staff, who may see every account the
  // credentials reach. A client's own user is never shown other accounts.
  discover?: boolean;
  // Stage map overrides from funnel_stage_map rows.
  stageMap?: Map<string, 'lead' | 'scheduled' | 'completed' | 'purchase'>;
}

export interface Connector {
  provider: 'boulevard' | 'housecallpro' | 'jobber' | 'meta-ads' | 'apple-maps-ads';
  getRequirements(): ConnectorRequirements;
  // How far back the first sync of a new connection reaches, for platforms
  // whose history is worth pulling in. Absent means the current month only.
  backfillDays?(creds: Record<string, string>): number;
  testConnection(creds: Record<string, string>, ctx?: ConnectorContext): Promise<TestConnectionResult>;
  syncMonth(
    creds: Record<string, string>,
    month: string,
    db: ConnectorDb,
    sourceKey: string,
    ctx?: ConnectorContext
  ): Promise<SyncStats | AdSyncStats>;
  handleWebhook?(payload: Record<string, unknown>, db: ConnectorDb, sourceKey: string): Promise<void>;
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map((n) => Number(n));
  const from = `${month}-01T00:00:00.000Z`;
  const to = new Date(Date.UTC(y ?? 2000, m ?? 1, 1)).toISOString();
  return { from, to };
}

let counter = 0;
export function syntheticId(prefix: string): string {
  counter = (counter + 1) % 1000000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}
