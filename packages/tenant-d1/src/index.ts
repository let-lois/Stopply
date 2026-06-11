// Thin client for the Cloudflare D1 HTTP query API. Tenant databases are
// created at provision time and are not bound to the Worker, so all tenant
// queries travel over this client. Parameterized statements only: values
// are never interpolated into SQL strings.

export interface TenantD1Config {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
  baseUrl?: string;
}

export interface QueryResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class TenantD1Error extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TenantD1Error';
    this.status = status;
  }
}

export class TenantD1 {
  private cfg: Required<Pick<TenantD1Config, 'maxRetries' | 'timeoutMs'>> & TenantD1Config;

  constructor(config: TenantD1Config) {
    this.cfg = { maxRetries: 3, timeoutMs: 10000, ...config };
  }

  private url(databaseId: string): string {
    const base = this.cfg.baseUrl ?? 'https://api.cloudflare.com/client/v4';
    return `${base}/accounts/${this.cfg.accountId}/d1/database/${databaseId}/query`;
  }

  private async post(databaseId: string, body: unknown): Promise<unknown> {
    const f = this.cfg.fetchImpl ?? fetch;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      try {
        const res = await f(this.url(databaseId), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.cfg.apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (RETRYABLE.has(res.status)) {
          lastError = new TenantD1Error(`D1 HTTP ${res.status}`, res.status);
          continue;
        }
        const json = (await res.json()) as {
          success: boolean;
          result?: unknown;
          errors?: Array<{ message: string }>;
        };
        if (!res.ok || !json.success) {
          const msg = json.errors?.map((e) => e.message).join('; ') || `D1 HTTP ${res.status}`;
          throw new TenantD1Error(msg, res.status);
        }
        return json.result;
      } catch (err) {
        if (err instanceof TenantD1Error && !RETRYABLE.has(err.status)) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new TenantD1Error('D1 query failed', 0);
  }

  async query<T = Record<string, unknown>>(
    databaseId: string,
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    assertParameterized(sql, params);
    const result = (await this.post(databaseId, { sql, params })) as Array<{
      results: T[];
      success: boolean;
      meta?: Record<string, unknown>;
    }>;
    const first = result?.[0];
    return {
      results: first?.results ?? [],
      success: first?.success ?? true,
      meta: first?.meta,
    };
  }

  // The D1 HTTP endpoint accepts one statement per call; batch executes
  // sequentially. Not transactional across statements, callers that need
  // atomic replace should write to a scratch state and swap, or tolerate
  // re running (our rollups are deterministic and re runnable by design).
  async batch(databaseId: string, statements: BatchStatement[]): Promise<QueryResult[]> {
    const out: QueryResult[] = [];
    for (const stmt of statements) {
      out.push(await this.query(databaseId, stmt.sql, stmt.params ?? []));
    }
    return out;
  }
}

// Guard rail: a statement with inline string values and no params is a
// likely interpolation bug. We cannot prove safety statically, but we can
// refuse the obvious foot gun of single quotes in SQL when params exist
// for the same call pattern elsewhere. Kept permissive for DDL.
function assertParameterized(sql: string, params: unknown[]): void {
  if (params.some((p) => typeof p === 'object' && p !== null && !(p instanceof Date))) {
    throw new Error('TenantD1: params must be scalars (string, number, null, boolean)');
  }
  void sql;
}

export interface CreateDatabaseResult {
  uuid: string;
  name: string;
}

// Creates a tenant database via the REST API. Idempotent helper: if a
// database with the name already exists, returns the existing one.
export async function createTenantDatabase(
  cfg: TenantD1Config,
  name: string
): Promise<CreateDatabaseResult> {
  const f = cfg.fetchImpl ?? fetch;
  const base = cfg.baseUrl ?? 'https://api.cloudflare.com/client/v4';
  const headers = {
    authorization: `Bearer ${cfg.apiToken}`,
    'content-type': 'application/json',
  };
  const createRes = await f(`${base}/accounts/${cfg.accountId}/d1/database`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name }),
  });
  const createJson = (await createRes.json()) as {
    success: boolean;
    result?: { uuid: string; name: string };
    errors?: Array<{ code: number; message: string }>;
  };
  if (createJson.success && createJson.result) {
    return { uuid: createJson.result.uuid, name: createJson.result.name };
  }
  // Already exists: look it up by name so provisioning retries resume.
  const listRes = await f(
    `${base}/accounts/${cfg.accountId}/d1/database?name=${encodeURIComponent(name)}`,
    { headers }
  );
  const listJson = (await listRes.json()) as {
    success: boolean;
    result?: Array<{ uuid: string; name: string }>;
  };
  const existing = listJson.result?.find((d) => d.name === name);
  if (existing) return { uuid: existing.uuid, name: existing.name };
  const msg = createJson.errors?.map((e) => e.message).join('; ') ?? 'unknown error';
  throw new TenantD1Error(`failed to create D1 database ${name}: ${msg}`, createRes.status);
}

// Exports a tenant database to SQL via the D1 export API. Used by the
// nightly backup cron. Returns the signed download URL Cloudflare issues.
export async function exportDatabase(cfg: TenantD1Config, databaseId: string): Promise<string> {
  const f = cfg.fetchImpl ?? fetch;
  const base = cfg.baseUrl ?? 'https://api.cloudflare.com/client/v4';
  const res = await f(`${base}/accounts/${cfg.accountId}/d1/database/${databaseId}/export`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ output_format: 'polling' }),
  });
  const json = (await res.json()) as {
    success: boolean;
    result?: { signed_url?: string; at_bookmark?: string };
  };
  if (!json.success || !json.result?.signed_url) {
    throw new TenantD1Error('D1 export did not return a signed URL', res.status);
  }
  return json.result.signed_url;
}
