// In memory fakes for the Workers bindings so route logic is testable in
// Vitest without wrangler. Only the call shapes our code uses are faked.

export class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, _opts?: unknown): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// Minimal SQL engine backed by better-sqlite3 style semantics is overkill;
// the control plane fake matches on registered patterns instead.
type Row = Record<string, unknown>;

export class FakeD1 {
  tables = new Map<string, Row[]>();
  private handlers: Array<{
    pattern: RegExp;
    run: (params: unknown[], db: FakeD1) => { results?: Row[]; first?: Row | null };
  }> = [];

  on(pattern: RegExp, run: (params: unknown[], db: FakeD1) => { results?: Row[]; first?: Row | null }) {
    this.handlers.push({ pattern, run });
    return this;
  }

  prepare(sql: string) {
    const db = this;
    return {
      bind(...params: unknown[]) {
        return {
          async first<T>() {
            return db.exec(sql, params).first as T | null;
          },
          async all<T>() {
            return { results: (db.exec(sql, params).results ?? []) as T[] };
          },
          async run() {
            db.exec(sql, params);
            return { success: true };
          },
        };
      },
      async first<T>() {
        return db.exec(sql, []).first as T | null;
      },
      async all<T>() {
        return { results: (db.exec(sql, []).results ?? []) as T[] };
      },
      async run() {
        db.exec(sql, []);
        return { success: true };
      },
    };
  }

  exec(sql: string, params: unknown[]) {
    for (const h of this.handlers) {
      if (h.pattern.test(sql)) {
        const out = h.run(params, this);
        return { results: out.results ?? [], first: out.first ?? out.results?.[0] ?? null };
      }
    }
    return { results: [], first: null };
  }
}

export function makeEnv(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    CONTROL_DB: new FakeD1(),
    SESSIONS: new FakeKV(),
    ASSETS: {},
    CSV_BUCKET: {},
    AGENCY_HOST: 'bi.letlois.com',
    TENANT_HOST_SUFFIX: '.bi.letlois.com',
    CF_API_TOKEN: 'test-token',
    CF_ACCOUNT_ID: 'test-account',
    CF_ZONE_ID: 'test-zone',
    CRED_MASTER_KEY: btoa(String.fromCharCode(...new Uint8Array(32))),
    ANTHROPIC_API_KEY: 'test-key',
    INGEST_PEPPER: 'test-pepper',
    ...overrides,
  };
}
