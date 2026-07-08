// Bulk insert building. The tenant databases are reached over the D1 HTTP
// API where every statement costs one Worker subrequest, and Workers cap
// subrequests per invocation (50 free / 1000 paid). Row-at-a-time writes
// made a 5,000-contact import need tens of thousands of subrequests; these
// helpers pack rows into multi-row VALUES statements instead.
//
// Values are rendered as SQL literals rather than bound parameters because
// D1 caps bound parameters at 100 per statement, which would defeat the
// batching (6-14 rows per statement for our wider tables). sqlQuote is the
// single escaping chokepoint: SQLite string literals have exactly one
// escape (doubling single quotes), and NUL bytes are stripped since SQLite
// text cannot carry them.

export type SqlScalar = string | number | boolean | null | undefined;

export function sqlQuote(v: SqlScalar): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'NULL';
    return String(v);
  }
  return `'${v.replace(/\u0000/g, '').replace(/'/g, "''")}'`;
}

// Packs rows into as few INSERT statements as fit under maxBytes each
// (D1 caps a statement at 100KB; the default leaves headroom). The
// optional suffix (e.g. an ON CONFLICT clause) is appended to every
// produced statement.
export function bulkInsertStatements(opts: {
  table: string;
  columns: string[];
  rows: SqlScalar[][];
  insert?: 'INSERT' | 'INSERT OR IGNORE' | 'INSERT OR REPLACE';
  suffix?: string;
  maxBytes?: number;
}): string[] {
  const { table, columns, rows } = opts;
  const insert = opts.insert ?? 'INSERT';
  const suffix = opts.suffix ? ` ${opts.suffix}` : '';
  const maxBytes = opts.maxBytes ?? 88_000;
  if (rows.length === 0) return [];

  const head = `${insert} INTO ${table} (${columns.join(', ')}) VALUES `;
  const statements: string[] = [];
  let tuples: string[] = [];
  let size = head.length + suffix.length;

  const flush = () => {
    if (tuples.length > 0) statements.push(head + tuples.join(', ') + suffix);
    tuples = [];
    size = head.length + suffix.length;
  };

  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(`bulkInsertStatements: row has ${row.length} values for ${columns.length} columns`);
    }
    const tuple = `(${row.map(sqlQuote).join(', ')})`;
    if (tuples.length > 0 && size + tuple.length + 2 > maxBytes) flush();
    tuples.push(tuple);
    size += tuple.length + 2;
  }
  flush();
  return statements;
}
