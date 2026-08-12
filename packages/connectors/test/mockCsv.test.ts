import { describe, it, expect } from 'vitest';
import { PARSER_REGISTRY } from '../src/parsers';
// @ts-expect-error plain JS module shared with scripts/seed-mock-data.mjs
import {
  rng,
  metaCampaignCsv,
  googleCampaignCsv,
  ghlContactsCsv,
  appointmentsCsv,
  salesCsv,
  d2dAccountsCsv,
} from '../../../scripts/lib/mock-csv.mjs';

// The seeder writes into a live tenant, so a header it gets wrong fails
// after the data is already partly in. These run every generated CSV
// through the same parser the API would use and assert it produced real
// records, which turns a column rename in parsers.ts into a red test here
// instead of a broken seed run.
const MONTH = '2026-06';

describe('mock CSV generators feed the real parsers', () => {
  it('meta-campaign yields ad spend rows', () => {
    const out = PARSER_REGISTRY['meta-campaign']!(metaCampaignCsv(MONTH, rng('t:meta')), MONTH);
    expect(out.kind).toBe('ad-spend');
    expect(out.adSpend!.length).toBeGreaterThan(0);
    for (const r of out.adSpend!) {
      expect(r.campaign).toBeTruthy();
      expect(r.spend).toBeGreaterThan(0);
      expect(r.channel).toBe('Meta');
    }
  });

  it('google-campaign yields ad spend rows', () => {
    const out = PARSER_REGISTRY['google-campaign']!(googleCampaignCsv(MONTH, rng('t:goog')), MONTH);
    expect(out.kind).toBe('ad-spend');
    expect(out.adSpend!.length).toBeGreaterThan(0);
    for (const r of out.adSpend!) {
      expect(r.campaign).toBeTruthy();
      expect(r.spend).toBeGreaterThan(0);
      expect(r.channel).toBe('Google');
    }
  });

  it('ghl-contacts yields contacts inside the requested month', () => {
    const out = PARSER_REGISTRY['ghl-contacts']!(ghlContactsCsv(MONTH, rng('t:ghl'), 60), MONTH);
    expect(out.kind).toBe('contacts');
    expect(out.contacts!.length).toBe(60);
    for (const c of out.contacts!) {
      expect(c.createdAt.startsWith(MONTH)).toBe(true);
      expect(c.email).toBeTruthy();
    }
    // Channel is derived from utm_source, so the generated mix must span
    // more than one channel or the dashboard shows a single bar.
    const channels = new Set(out.contacts!.map((c) => c.channel));
    expect(channels.size).toBeGreaterThan(1);
  });

  it('blvd-appointments yields scheduled and completed stage events', () => {
    const { csv } = appointmentsCsv(MONTH, rng('t:appt'), 80);
    const out = PARSER_REGISTRY['blvd-appointments']!(csv, MONTH);
    expect(out.kind).toBe('stage-events');
    const stages = new Set(out.stageEvents!.map((e) => e.stage));
    expect(stages.has('scheduled')).toBe(true);
    expect(stages.has('completed')).toBe(true);
  });

  it('blvd-line-items yields purchases carrying revenue', () => {
    const out = PARSER_REGISTRY['blvd-line-items']!(salesCsv(MONTH, rng('t:sale'), 60), MONTH);
    expect(out.kind).toBe('stage-events');
    expect(out.stageEvents!.length).toBeGreaterThan(0);
    for (const e of out.stageEvents!) {
      expect(e.stage).toBe('purchase');
      expect(e.amount!).toBeGreaterThan(0);
    }
  });

  it('d2d-accounts yields rep metrics for both leaderboards', () => {
    const out = PARSER_REGISTRY['d2d-accounts']!(d2dAccountsCsv(MONTH, rng('t:d2d'), 300), MONTH);
    expect(out.kind).toBe('d2d-accounts');
    expect(out.repMetrics!.length).toBeGreaterThan(0);
    const totals = out.repMetrics!.reduce(
      (acc, r) => ({
        knocks: acc.knocks + r.knocks,
        appointmentsSet: acc.appointmentsSet + r.appointmentsSet,
        sitsRun: acc.sitsRun + r.sitsRun,
        closes: acc.closes + r.closes,
      }),
      { knocks: 0, appointmentsSet: 0, sitsRun: 0, closes: 0 }
    );
    // Setters need knocks and appointments, closers need sits and closes.
    // A generator that produced knocks only would leave the Closers table
    // empty, which is the failure this guards.
    expect(totals.knocks).toBeGreaterThan(0);
    expect(totals.appointmentsSet).toBeGreaterThan(0);
    expect(totals.sitsRun).toBeGreaterThan(0);
    expect(totals.closes).toBeGreaterThan(0);
    // Funnel must narrow, not widen.
    expect(totals.knocks).toBeGreaterThan(totals.appointmentsSet);
    expect(totals.appointmentsSet).toBeGreaterThanOrEqual(totals.sitsRun);
    expect(totals.sitsRun).toBeGreaterThanOrEqual(totals.closes);
  });

  it('is deterministic for the same tenant and month', () => {
    expect(metaCampaignCsv(MONTH, rng('acme:2026-06'))).toBe(metaCampaignCsv(MONTH, rng('acme:2026-06')));
    expect(metaCampaignCsv(MONTH, rng('acme:2026-06'))).not.toBe(metaCampaignCsv(MONTH, rng('other:2026-06')));
  });
});
