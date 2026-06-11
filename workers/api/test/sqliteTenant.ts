// A TenantD1 compatible client backed by an in memory SQLite database
// running the real tenant migrations, so ingest, import, and rollup tests
// execute genuine SQL semantics instead of mocks.

import Database from 'better-sqlite3';
import { TENANT_MIGRATIONS, splitStatements } from '@letlois/db/migrations';
import type { BatchStatement, QueryResult } from '@letlois/tenant-d1';

export class SqliteTenantD1 {
  db: Database.Database;

  constructor() {
    this.db = new Database(':memory:');
    for (const migration of TENANT_MIGRATIONS) {
      for (const stmt of splitStatements(migration.sql)) {
        this.db.exec(stmt);
      }
    }
  }

  async query<T = Record<string, unknown>>(
    _databaseId: string,
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    const cleaned = params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
    const stmt = this.db.prepare(sql);
    if (stmt.reader) {
      return { results: stmt.all(...cleaned) as T[], success: true };
    }
    stmt.run(...cleaned);
    return { results: [], success: true };
  }

  async batch(databaseId: string, statements: BatchStatement[]): Promise<QueryResult[]> {
    const out: QueryResult[] = [];
    for (const s of statements) {
      out.push(await this.query(databaseId, s.sql, s.params ?? []));
    }
    return out;
  }
}
