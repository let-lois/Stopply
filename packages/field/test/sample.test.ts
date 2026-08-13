import { describe, expect, it } from 'vitest';
import { buildSampleData, rng } from '../src/sample';
import { DEFAULT_DISPOSITIONS, dispositionIndex } from '../src/dispositions';
import { byRep, summarize } from '../src/stats';

const NOW = new Date('2026-08-13T12:00:00.000Z');
const INDEX = dispositionIndex(DEFAULT_DISPOSITIONS);

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = rng('seed-one');
    const b = rng('seed-one');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('differs between seeds', () => {
    expect(rng('one')()).not.toBe(rng('two')());
  });
});

describe('buildSampleData', () => {
  const data = buildSampleData({ now: NOW, days: 30 });

  it('regenerates identically from the same seed', () => {
    const again = buildSampleData({ now: NOW, days: 30 });
    expect(again.visits.length).toBe(data.visits.length);
    expect(again.visits[0]).toEqual(data.visits[0]);
  });

  it('produces a crew and a month of work', () => {
    expect(data.reps.length).toBeGreaterThanOrEqual(4);
    expect(data.reps.some((r) => r.role === 'manager')).toBe(true);
    expect(data.visits.length).toBeGreaterThan(1000);
  });

  it('gives every visit a unique client_uuid, as the real app would', () => {
    // The uniqueness constraint is real in the database, so sample data
    // that collided would fail to insert.
    const ids = new Set(data.visits.map((v) => v.clientUuid));
    expect(ids.size).toBe(data.visits.length);
  });

  it('only lists doors that were actually knocked', () => {
    const referenced = new Set(data.visits.map((v) => v.addressId));
    expect(data.addresses.length).toBe(referenced.size);
    for (const a of data.addresses) expect(referenced.has(a.id)).toBe(true);
  });

  it('reads like a real funnel rather than a flattering one', () => {
    const totals = summarize(
      data.visits.map((v) => ({
        id: v.id,
        repId: v.repId,
        repName: null,
        addressId: v.addressId,
        disposition: v.disposition,
        occurredAt: v.occurredAt,
      })),
      INDEX
    );
    // Most doors reach nobody.
    expect(totals.contactRate).toBeGreaterThan(0.3);
    expect(totals.contactRate).toBeLessThan(0.65);
    // Sales are rare, and knocks per sale lands somewhere a manager would
    // recognise rather than somewhere that oversells the product.
    expect(totals.sales).toBeGreaterThan(0);
    expect(totals.knocksPerSale).toBeGreaterThan(20);
    expect(totals.knocksPerSale).toBeLessThan(200);
  });

  it('makes reps differ from each other so a leaderboard means something', () => {
    const rows = byRep(
      data.visits.map((v) => ({
        id: v.id,
        repId: v.repId,
        repName: null,
        addressId: v.addressId,
        disposition: v.disposition,
        occurredAt: v.occurredAt,
      })),
      INDEX,
      'America/Phoenix'
    );
    const knocks = rows.map((r) => r.visits);
    expect(new Set(knocks).size).toBeGreaterThan(1);
    expect(Math.max(...knocks)).toBeGreaterThan(Math.min(...knocks) * 1.2);
  });

  it('never knocks a household again after it asked to be left alone', () => {
    const byAddress = new Map<string, typeof data.visits>();
    for (const v of data.visits) {
      const list = byAddress.get(v.addressId) ?? [];
      list.push(v);
      byAddress.set(v.addressId, list);
    }
    for (const [, list] of byAddress) {
      const sorted = [...list].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
      const stop = sorted.findIndex((v) => v.disposition === 'do_not_knock');
      if (stop >= 0) expect(stop).toBe(sorted.length - 1);
    }
  });

  it('takes Sundays off so the daily chart has a real rhythm', () => {
    const sundays = data.visits.filter((v) => new Date(v.occurredAt).getUTCDay() === 0);
    expect(sundays).toHaveLength(0);
  });

  it('stays inside the requested window', () => {
    const oldest = data.visits.map((v) => v.occurredAt).sort()[0] as string;
    const ageDays = (NOW.getTime() - Date.parse(oldest)) / 86400000;
    expect(ageDays).toBeLessThanOrEqual(30);
  });

  it('captures a contact only where somebody actually answered', () => {
    for (const v of data.visits) {
      if (v.contactName) {
        expect(['callback', 'appointment', 'sale']).toContain(v.disposition);
      }
    }
  });

  it('uses addresses that cannot be mistaken for a real customer', () => {
    for (const r of data.reps) expect(r.email).toMatch(/@example\.invalid$/);
  });

  it('caps a silly day count instead of building forever', () => {
    const huge = buildSampleData({ now: NOW, days: 5000 });
    const oldest = huge.visits.map((v) => v.occurredAt).sort()[0] as string;
    expect((NOW.getTime() - Date.parse(oldest)) / 86400000).toBeLessThanOrEqual(120);
  });
});
