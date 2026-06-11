import { describe, it, expect } from 'vitest';
import { computeRollup, type ContactRow, type RollupInputs, type StageEventRow } from '../src/rollup';

function contact(id: string, createdAt: string, channel: string, extra: Partial<ContactRow> = {}): ContactRow {
  return {
    id,
    email_norm: `${id}@x.com`,
    phone_last10: null,
    name_norm: null,
    created_at: createdAt,
    first_touch_channel: channel,
    first_touch_source: null,
    first_touch_campaign: null,
    latest_touch_channel: channel,
    latest_touch_campaign: null,
    match_method: 'email',
    match_ambiguous: 0,
    ...extra,
  };
}

function stage(
  id: string,
  contactId: string | null,
  stageName: StageEventRow['stage'],
  occurredAt: string,
  amount: number | null = null,
  rawJson: string | null = null
): StageEventRow {
  return {
    id,
    contact_id: contactId,
    external_ref: id,
    stage: stageName,
    occurred_at: occurredAt,
    amount,
    source_key: 'test',
    raw_json: rawJson,
  };
}

function baseInputs(overrides: Partial<RollupInputs> = {}): RollupInputs {
  return {
    month: '2026-05',
    contacts: [],
    stageEvents: [],
    adSpend: [],
    clientRecords: [],
    partialOnlyCount: 0,
    ...overrides,
  };
}

describe('cohort bucketing', () => {
  it('buckets completions at 0, 30, 60, 90 days with a running total', () => {
    const created = '2026-05-01T00:00:00.000Z';
    const inputs = baseInputs({
      contacts: [
        contact('a', created, 'Google'),
        contact('b', created, 'Google'),
        contact('c', created, 'Google'),
        contact('d', created, 'Google'),
      ],
      stageEvents: [
        stage('l-a', 'a', 'lead', created),
        stage('l-b', 'b', 'lead', created),
        stage('l-c', 'c', 'lead', created),
        stage('l-d', 'd', 'lead', created),
        // a completes in month (day 9), b at day 45, c at day 75, d at day 120.
        stage('s1', 'a', 'completed', '2026-05-10T00:00:00.000Z'),
        stage('s2', 'b', 'completed', '2026-06-15T00:00:00.000Z'),
        stage('s3', 'c', 'completed', '2026-07-15T00:00:00.000Z'),
        stage('s4', 'd', 'completed', '2026-08-29T00:00:00.000Z'),
        stage('p1', 'a', 'purchase', '2026-05-10T00:00:00.000Z', 100),
        stage('p2', 'b', 'purchase', '2026-06-15T00:00:00.000Z', 200),
        stage('p4', 'd', 'purchase', '2026-08-29T00:00:00.000Z', 400),
      ],
    });
    const out = computeRollup(inputs);
    const bucket = (b: string) => out.cohort.find((r) => r.channel === 'Google' && r.bucket === b)!;
    expect(bucket('0').completed).toBe(1); // same month only
    expect(bucket('30').completed).toBe(1); // within 30 days
    expect(bucket('60').completed).toBe(2); // + day 45
    expect(bucket('90').completed).toBe(3); // + day 75
    expect(bucket('total').completed).toBe(4); // everything
    expect(bucket('0').revenue).toBe(100);
    expect(bucket('90').revenue).toBe(300);
    expect(bucket('total').revenue).toBe(700);
  });
});

describe('on or after created_at rule', () => {
  it('ignores stage events that occurred before the contact existed', () => {
    const inputs = baseInputs({
      contacts: [contact('late', '2026-05-15T00:00:00.000Z', 'Meta')],
      stageEvents: [
        stage('l1', 'late', 'lead', '2026-05-15T00:00:00.000Z'),
        // A completed event from before the contact was created: an old
        // client re entering as a lead must not claim history.
        stage('old', 'late', 'completed', '2026-05-02T00:00:00.000Z'),
        stage('new', 'late', 'completed', '2026-05-20T00:00:00.000Z'),
        stage('oldrev', 'late', 'purchase', '2026-05-01T00:00:00.000Z', 999),
      ],
    });
    const out = computeRollup(inputs);
    const meta = out.monthlyMetrics.find((m) => m.channel === 'Meta' && m.attribution_basis === 'first')!;
    expect(meta.completed).toBe(1);
    expect(meta.revenue).toBe(0);
    const total = out.cohort.find((r) => r.channel === 'Meta' && r.bucket === 'total')!;
    expect(total.completed).toBe(1);
    expect(total.revenue).toBe(0);
  });
});

describe('attribution bases', () => {
  it('computes first and latest touch rows so the UI toggle is instant', () => {
    const inputs = baseInputs({
      contacts: [
        contact('x', '2026-05-02T00:00:00.000Z', 'Google', { latest_touch_channel: 'Meta' }),
      ],
      stageEvents: [stage('l1', 'x', 'lead', '2026-05-02T00:00:00.000Z')],
    });
    const out = computeRollup(inputs);
    const first = out.monthlyMetrics.find((m) => m.attribution_basis === 'first')!;
    const latest = out.monthlyMetrics.find((m) => m.attribution_basis === 'latest')!;
    expect(first.channel).toBe('Google');
    expect(first.leads).toBe(1);
    expect(latest.channel).toBe('Meta');
    expect(latest.leads).toBe(1);
  });
});

describe('identity matching inside the rollup', () => {
  it('matches an unlinked purchase to a contact via name hints and flags ambiguity', () => {
    const inputs = baseInputs({
      contacts: [
        contact('amb1', '2026-05-01T00:00:00.000Z', 'Google', { name_norm: 'lee sky' }),
        contact('amb2', '2026-05-01T00:00:00.000Z', 'Meta', { name_norm: 'lee sky', email_norm: null }),
      ],
      stageEvents: [
        stage('l1', 'amb1', 'lead', '2026-05-01T00:00:00.000Z'),
        stage('l2', 'amb2', 'lead', '2026-05-01T00:00:00.000Z'),
        stage('p1', null, 'purchase', '2026-05-10T00:00:00.000Z', 500, JSON.stringify({ nameNorm: 'lee sky' })),
      ],
    });
    const out = computeRollup(inputs);
    expect(out.quality.ambiguous_match_count).toBeGreaterThan(0);
    const google = out.monthlyMetrics.find((m) => m.channel === 'Google' && m.attribution_basis === 'first')!;
    expect(google.revenue).toBe(500);
  });

  it('counts unmatched non lead events in month_quality', () => {
    const inputs = baseInputs({
      stageEvents: [
        stage('p1', null, 'purchase', '2026-05-10T00:00:00.000Z', 100, JSON.stringify({ nameNorm: 'ghost person' })),
      ],
    });
    const out = computeRollup(inputs);
    expect(out.quality.unmatched_lead_count).toBe(1);
  });

  it('uses the client record bridge for integration events', () => {
    const inputs = baseInputs({
      contacts: [contact('c9', '2026-05-01T00:00:00.000Z', 'Google', { name_norm: 'doe jane' })],
      stageEvents: [
        stage('l1', 'c9', 'lead', '2026-05-01T00:00:00.000Z'),
        stage('s1', null, 'completed', '2026-05-12T00:00:00.000Z', null, JSON.stringify({ clientId: 'cl-77' })),
      ],
      clientRecords: [{ clientId: 'cl-77', emailNorm: 'c9@x.com', phoneLast10: null, nameNorm: 'doe jane' }],
    });
    const out = computeRollup(inputs);
    const google = out.monthlyMetrics.find((m) => m.channel === 'Google' && m.attribution_basis === 'first')!;
    expect(google.completed).toBe(1);
  });
});

describe('determinism', () => {
  it('re running the rollup produces byte identical output', () => {
    const inputs = baseInputs({
      contacts: [
        contact('a', '2026-05-01T00:00:00.000Z', 'Google'),
        contact('b', '2026-05-03T00:00:00.000Z', 'Meta'),
      ],
      stageEvents: [
        stage('l1', 'a', 'lead', '2026-05-01T00:00:00.000Z'),
        stage('l2', 'b', 'lead', '2026-05-03T00:00:00.000Z'),
        stage('p1', 'a', 'purchase', '2026-05-10T00:00:00.000Z', 123.45),
      ],
      adSpend: [
        { period_month: '2026-05', channel: 'Google', campaign: 'Brand', spend: 1000, leads_reported: 10 },
      ],
    });
    const a = JSON.stringify(computeRollup(inputs));
    const b = JSON.stringify(computeRollup(JSON.parse(JSON.stringify(inputs))));
    expect(a).toBe(b);
  });
});

describe('spend join', () => {
  it('lands spend on both bases and on campaign metrics', () => {
    const inputs = baseInputs({
      adSpend: [
        { period_month: '2026-05', channel: 'Google', campaign: 'Brand', spend: 750.5, leads_reported: null },
        { period_month: '2026-05', channel: 'Google', campaign: 'PMax', spend: 249.5, leads_reported: null },
      ],
    });
    const out = computeRollup(inputs);
    for (const basis of ['first', 'latest']) {
      const row = out.monthlyMetrics.find((m) => m.channel === 'Google' && m.attribution_basis === basis)!;
      expect(row.spend).toBe(1000);
    }
    expect(out.campaignMetrics.map((c) => c.spend)).toEqual([750.5, 249.5]);
  });
});
