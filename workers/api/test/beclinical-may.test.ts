// Phase 3 acceptance: importing the Be Clinical May sample data through
// the real pipeline (CSV parsers, contact upsert, SQLite tenant schema,
// rollup engine) reproduces the hand checked numbers: 208 leads, 26
// showed (completed), 36403 revenue in month, with the ambiguous match
// count surfaced.

import { describe, it, expect, beforeAll } from 'vitest';
import { PARSER_REGISTRY } from '@letlois/connectors';
import { runRollup, type RollupDb } from '@letlois/attribution';
import { SqliteTenantD1 } from './sqliteTenant';
import { applyParseResult } from '../src/routes/imports';

const MONTH = '2026-05';

// Deterministic fixture mirroring the Be Clinical May export shapes.
// 208 GHL contacts; 30 booked Boulevard appointments of which 26 reached
// a final state inside May; line items totaling exactly 36403.00 in May.
// Two contacts share a normalized name to exercise the ambiguity counter.
// Names must survive normalization (digits are stripped per token), so
// synthetic names spell the index in letters.
function alphaId(n: number): string {
  return String(n)
    .split('')
    .map((d) => 'abcdefghij'[Number(d)])
    .join('');
}

function personName(i: number): { first: string; last: string } {
  if (i >= 207) return { first: 'Casey', last: 'Morgan' };
  return { first: `First${alphaId(i)}`, last: `Last${alphaId(i)}` };
}

function buildFixtures() {
  const ghlRows = ['Contact Id,First Name,Last Name,Email,Phone,Created,Followup Stage,Treatment of Interest,Tags,utm_source,campaign name,clickld'];
  const channels = [
    { tag: 'facebook lead', n: 96 },
    { tag: 'google lead', n: 72 },
    { tag: 'website form', n: 40 },
  ];
  let i = 0;
  for (const { tag, n } of channels) {
    for (let k = 0; k < n; k++) {
      i++;
      const day = String((i % 28) + 1).padStart(2, '0');
      // Contacts 207 and 208 share the name "Casey Morgan" with no email
      // or phone overlap: a name key mapping to two identities.
      const { first, last } = personName(i);
      const email = `lead${i}@example.com`;
      const phone = `602555${String(1000 + i).slice(-4)}`;
      ghlRows.push(
        `g${i},${first},${last},${email},${phone},5/${day}/2026 10:00 am,New Lead,Botox,${tag},,May Promo,`
      );
    }
  }
  const ghlCsv = ghlRows.join('\n');

  // Boulevard clients bridging appointment client ids to the first 30
  // GHL identities by email and name.
  const clientRows = ['Id,First Name,Last Name,Email,Mobile Phone'];
  for (let k = 1; k <= 30; k++) {
    const { first, last } = personName(k);
    clientRows.push(`cl${k},${first},${last},lead${k}@example.com,602555${String(1000 + k).slice(-4)}`);
  }
  const clientsCsv = clientRows.join('\n');

  const apptRows = ['Appointment Id,Client Id,Client Name,Start At,State'];
  for (let k = 1; k <= 30; k++) {
    const day = String((k % 27) + 2).padStart(2, '0');
    const state = k <= 26 ? 'final' : 'booked';
    const { first, last } = personName(k);
    apptRows.push(`ap${k},cl${k},${first} ${last},5/${day}/2026 1:00 pm,${state}`);
  }
  const apptsCsv = apptRows.join('\n');

  // Line items: 26 sales summing to exactly 36403.00.
  const lineRows = ['Line Item Id,Client Name,Sale Date,Net Sales'];
  const base = Math.floor(36403 / 26); // 1400
  let allocated = 0;
  for (let k = 1; k <= 26; k++) {
    const amount = k === 26 ? 36403 - allocated : base;
    allocated += amount;
    const day = String((k % 27) + 2).padStart(2, '0');
    // Line item 26 carries the shared Casey Morgan name so the name only
    // join exercises the ambiguity flag while keeping in month revenue.
    const { first, last } = k === 26 ? { first: 'Casey', last: 'Morgan' } : personName(k);
    lineRows.push(`li${k},"${last}, ${first}",5/${day}/2026,"$${amount}.00"`);
  }
  const linesCsv = lineRows.join('\n');

  const metaCsv = 'Campaign name,Amount spent (USD),Results\nMay Promo,4200.00,96\n';
  const googleCsv = 'Campaign,Cost,Conversions\nBrand,3100.00,72\n';

  return { ghlCsv, clientsCsv, apptsCsv, linesCsv, metaCsv, googleCsv };
}

function rollupDb(tenantDb: SqliteTenantD1): RollupDb {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const { results } = await tenantDb.query<T>('db', sql, params);
      return results;
    },
    async batch(statements) {
      await tenantDb.batch('db', statements);
    },
  };
}

describe('Be Clinical May sample', () => {
  let tenantDb: SqliteTenantD1;
  let totals: { leads: number; completed: number; revenue: number; scheduled: number };
  let quality: Record<string, unknown>;

  beforeAll(async () => {
    tenantDb = new SqliteTenantD1();
    const fx = buildFixtures();
    const imports: Array<[string, string, string]> = [
      ['ghl-contacts', 'ghl-csv', fx.ghlCsv],
      ['blvd-clients', 'blvd-clients-csv', fx.clientsCsv],
      ['blvd-appointments', 'blvd-appts-csv', fx.apptsCsv],
      ['blvd-line-items', 'blvd-lines-csv', fx.linesCsv],
      ['meta-campaign', 'meta-csv', fx.metaCsv],
      ['google-campaign', 'google-csv', fx.googleCsv],
    ];
    for (const [parserKey, sourceKey, csv] of imports) {
      const parsed = PARSER_REGISTRY[parserKey]!(csv, MONTH);
      await applyParseResult(tenantDb as never, 'db', sourceKey, MONTH, parsed);
    }
    const outputs = await runRollup(rollupDb(tenantDb), MONTH);
    const firstBasis = outputs.monthlyMetrics.filter((m) => m.attribution_basis === 'first');
    totals = firstBasis.reduce(
      (acc, m) => ({
        leads: acc.leads + m.leads,
        completed: acc.completed + m.completed,
        revenue: Math.round((acc.revenue + m.revenue) * 100) / 100,
        scheduled: acc.scheduled + m.scheduled,
      }),
      { leads: 0, completed: 0, revenue: 0, scheduled: 0 }
    );
    quality = outputs.quality as unknown as Record<string, unknown>;
  });

  it('reproduces 208 leads', () => {
    expect(totals.leads).toBe(208);
  });

  it('reproduces 26 showed (completed)', () => {
    expect(totals.completed).toBe(26);
  });

  it('reproduces 36403 revenue in month within rounding', () => {
    expect(Math.abs(totals.revenue - 36403)).toBeLessThan(1);
  });

  it('surfaces the ambiguous match count', () => {
    expect(Number(quality.ambiguous_match_count)).toBeGreaterThan(0);
  });

  it('re running the rollup is byte identical', async () => {
    const a = JSON.stringify(await runRollup(rollupDb(tenantDb), MONTH));
    const b = JSON.stringify(await runRollup(rollupDb(tenantDb), MONTH));
    expect(a).toBe(b);
  });

  it('spend lands by channel', async () => {
    const rows = await tenantDb.query<{ channel: string; spend: number }>(
      'db',
      `SELECT channel, spend FROM monthly_metrics WHERE attribution_basis = 'first' ORDER BY channel`
    );
    const spend = Object.fromEntries(rows.results.map((r) => [r.channel, r.spend]));
    expect(spend['Meta']).toBe(4200);
    expect(spend['Google']).toBe(3100);
  });
});
