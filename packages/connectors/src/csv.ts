// Dependency free CSV parser. Handles quoted fields, embedded commas,
// embedded newlines, escaped quotes, and case insensitive headers.

export interface CsvTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export interface CsvRecords {
  headers: string[];
  records: string[][];
}

// Tokenizes CSV text into raw records without collapsing columns. Some CRM
// exports carry near-duplicate header names (e.g. "Appointment" and
// "Appointment " differing only by a trailing space, one a stage and one a
// disposition); those collide in parseCsv's dict rows since headers are
// trimmed, so duplicate-sensitive parsers read this form instead.
export function parseCsvRecords(text: string): CsvRecords {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  // Strip a UTF-8 BOM if present.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Drop fully empty trailing records.
  while (records.length && records[records.length - 1]!.every((f) => f.trim() === '')) {
    records.pop();
  }
  if (records.length === 0) return { headers: [], records: [] };
  return { headers: records[0]!.map((h) => h.trim()), records: records.slice(1) };
}

export function parseCsv(text: string): CsvTable {
  const { headers, records } = parseCsvRecords(text);
  if (headers.length === 0) return { headers: [], rows: [] };
  const lowerHeaders = headers.map((h) => h.toLowerCase());
  const rows = records.map((rec) => {
    const row: Record<string, string> = {};
    for (let i = 0; i < lowerHeaders.length; i++) {
      row[lowerHeaders[i]!] = (rec[i] ?? '').trim();
    }
    return row;
  });
  return { headers, rows };
}

// Case insensitive field lookup with alias support. Returns the first
// non empty value among the candidate header names.
export function pick(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const v = row[name.toLowerCase()];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}
