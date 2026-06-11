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

export interface ConnectorContext {
  fetchImpl?: typeof fetch;
  // Stage map overrides from funnel_stage_map rows.
  stageMap?: Map<string, 'lead' | 'scheduled' | 'completed' | 'purchase'>;
}

export interface Connector {
  provider: 'boulevard' | 'housecallpro' | 'jobber';
  getRequirements(): ConnectorRequirements;
  testConnection(creds: Record<string, string>, ctx?: ConnectorContext): Promise<TestConnectionResult>;
  syncMonth(
    creds: Record<string, string>,
    month: string,
    db: ConnectorDb,
    sourceKey: string,
    ctx?: ConnectorContext
  ): Promise<SyncStats>;
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
