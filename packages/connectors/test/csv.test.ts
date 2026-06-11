import { describe, it, expect } from 'vitest';
import { parseCsv, pick } from '../src/csv';

describe('parseCsv', () => {
  it('parses quoted fields with embedded commas and newlines', () => {
    const text = 'Name,Note,Amount\n"Doe, Jane","line one\nline two","$1,234.56"\n';
    const { rows } = parseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!['name']).toBe('Doe, Jane');
    expect(rows[0]!['note']).toBe('line one\nline two');
    expect(rows[0]!['amount']).toBe('$1,234.56');
  });

  it('handles escaped quotes', () => {
    const { rows } = parseCsv('a,b\n"She said ""hi""",2');
    expect(rows[0]!['a']).toBe('She said "hi"');
  });

  it('is case insensitive on headers', () => {
    const { rows } = parseCsv('First Name,EMAIL\nJane,j@x.com');
    expect(pick(rows[0]!, 'first name')).toBe('Jane');
    expect(pick(rows[0]!, 'email')).toBe('j@x.com');
  });

  it('strips a BOM and trailing blank lines', () => {
    const { rows, headers } = parseCsv('﻿a,b\n1,2\n\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toHaveLength(1);
  });

  it('handles CRLF line endings', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]!['b']).toBe('4');
  });
});
