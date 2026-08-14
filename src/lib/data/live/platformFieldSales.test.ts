// Door to door, read from the BI platform.
//
// The test that matters here is the renamed outcome. The platform's fake
// carries a disposition called quote_left, which this app has never heard of
// and which no built-in list contains. Everything downstream has to keep
// working anyway, because that is the whole claim the catalog makes. If any of
// this ever starts keying off the name, quote_left is the row that says so.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { setCsrfToken } from '@/lib/api/platform/wire';
import { signIn } from '@/lib/api/platform/session';
import { resetTenantContext } from '@/lib/api/platform/tenantContext';
import {
  catalogFromRows,
  splitAddress,
  fetchFieldSalesFromPlatform,
} from '@/lib/data/live/platformFieldSales';
import { rankFromFlags } from '@/modules/field-sales/catalog';
import { selectFunnel, buildJourneys } from '@/modules/field-sales/funnel';

const BASE = 'http://127.0.0.1:8791';

let jar = new Map<string, string>();

function installFetch() {
  const real: typeof fetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== 'string') throw new Error('the test fetch expects a path');
    const url = input.startsWith('http') ? input : `${BASE}${input}`;
    const headers = new Headers(init?.headers);
    if (jar.size > 0) {
      headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    const response = await real(url, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const [name, ...rest] = setCookie.split(';')[0]!.split('=');
      const value = rest.join('=');
      if (value === '') jar.delete(name!);
      else jar.set(name!, value);
    }
    return response;
  };
}

beforeAll(() => {
  installFetch();
});

afterEach(() => {
  jar = new Map();
  setCsrfToken(null);
  resetTenantContext();
});

describe('ranking an outcome by its flags', () => {
  const flags = (over: Partial<Record<string, number>> = {}) => ({
    is_contact: 0,
    is_lead: 0,
    is_appointment: 0,
    is_sale: 0,
    marks_do_not_knock: 0,
    ...over,
  });

  it('reads downwards, so a sale does not flatten into a contact', () => {
    // The platform's flags are cumulative: a sale row has every flag set.
    // Testing upwards would stop at is_contact and score every sale a 2, which
    // would empty the bottom of the funnel while the top looked healthy.
    expect(rankFromFlags(flags({ is_contact: 1, is_lead: 1, is_appointment: 1, is_sale: 1 }))).toBe(5);
    expect(rankFromFlags(flags({ is_contact: 1, is_lead: 1, is_appointment: 1 }))).toBe(3);
    expect(rankFromFlags(flags({ is_contact: 1, is_lead: 1 }))).toBe(2);
    expect(rankFromFlags(flags({ is_contact: 1 }))).toBe(2);
  });

  it('still counts a knock nobody answered', () => {
    // Rank 1, not 0. A no-answer is a door that was worked, and dropping it
    // would undercount the crew's day at the widest part of the funnel.
    expect(rankFromFlags(flags())).toBe(1);
  });
});

describe('the catalog from a client’s own rows', () => {
  const row = (over: Record<string, unknown>) => ({
    key: 'x',
    label: 'X',
    sort_order: 10,
    is_contact: 0,
    is_lead: 0,
    is_appointment: 0,
    is_sale: 0,
    marks_do_not_knock: 0,
    color: null,
    ...over,
  });

  it('ranks an outcome this app has never heard of', () => {
    const catalog = catalogFromRows([
      row({ key: 'left_a_quote', label: 'Left a quote', is_contact: 1, is_lead: 1 }),
    ]);
    expect(catalog.rankOf('left_a_quote')).toBe(2);
    expect(catalog.labelOf('left_a_quote')).toBe('Left a quote');
  });

  it('keeps a renamed sale at the bottom of the funnel', () => {
    // The failure this guards: a client renames "Sold" to "Won", and reporting
    // that matched on the key 'sale' reports no sales at all while the crew is
    // closing every day.
    const catalog = catalogFromRows([
      row({ key: 'won', label: 'Won', is_contact: 1, is_lead: 1, is_appointment: 1, is_sale: 1 }),
    ]);
    expect(catalog.rankOf('won')).toBe(5);
  });

  it('gives every outcome a colour, including ones with none set', () => {
    const catalog = catalogFromRows([
      row({ key: 'a', sort_order: 1 }),
      row({ key: 'b', sort_order: 2 }),
      row({ key: 'c', sort_order: 3, color: '#123456' }),
    ]);
    const hex = catalog.hexFor('dark');
    expect(hex['c']).toBe('#123456');
    // Distinct, not both grey. A map where every custom outcome is the same
    // colour has a legend that cannot be read.
    expect(hex['a']).toBeTruthy();
    expect(hex['b']).toBeTruthy();
    expect(hex['a']).not.toBe(hex['b']);
  });

  it('adds the unvisited door, which the platform has no row for', () => {
    const catalog = catalogFromRows([row({ key: 'a' })]);
    expect(catalog.rankOf('not_visited')).toBe(0);
  });
});

describe('splitting an address line', () => {
  it('separates the parts the views show separately', () => {
    expect(splitAddress('1700 Magnolia Ave, Riverside, CA 92503')).toEqual({
      address: '1700 Magnolia Ave',
      city: 'Riverside',
      state: 'CA',
      postalCode: '92503',
    });
  });

  it('keeps a line it cannot parse whole', () => {
    // Shown as stored rather than chopped at the wrong comma. A half-parsed
    // address on a door list is worse than an unparsed one: a rep reads the
    // street and goes to the wrong town.
    expect(splitAddress('Flat 2 Riverside')).toEqual({
      address: 'Flat 2 Riverside',
      city: '',
      state: '',
      postalCode: '',
    });
  });
});

describe('against the platform', () => {
  async function loadAllstar() {
    await signIn('noah@letlois.com', 'whatever');
    return fetchFieldSalesFromPlatform('tn_allstar');
  }

  it('reads the doors, the knocks and the crew', async () => {
    const slice = await loadAllstar();
    expect(slice.properties.length).toBeGreaterThan(0);
    expect(slice.visits.length).toBeGreaterThan(0);
    expect(slice.reps.map((r) => r.name)).toEqual(['Marcus Webb', 'Priya Anand']);
    // The platform has no territories. Empty, not invented.
    expect(slice.territories).toEqual([]);
  });

  it('counts the renamed outcome as a contact in the funnel', async () => {
    const slice = await loadAllstar();
    const quoteVisits = slice.visits.filter((v) => v.disposition === 'quote_left');
    // The fake carries one on purpose. If this is zero the test below proves
    // nothing, so it is asserted rather than assumed.
    expect(quoteVisits.length).toBeGreaterThan(0);

    const journeys = buildJourneys(slice.visits, slice.catalog);
    for (const visit of quoteVisits) {
      const journey = journeys.get(visit.propertyId)!;
      // Contacted, because the client flagged it is_contact. Nothing here
      // recognises the word "quote".
      expect(journey.contacted).toBeTruthy();
    }

    const funnel = selectFunnel(slice.visits, slice.catalog);
    const contacted = funnel.steps.find((s) => s.stage === 'contacted')!;
    expect(contacted.doors).toBeGreaterThanOrEqual(quoteVisits.length);
  });

  it('never counts a booking as kept unless it also sold', async () => {
    const slice = await loadAllstar();
    const funnel = selectFunnel(slice.visits, slice.catalog);
    const at = (stage: string) => funnel.steps.find((s) => s.stage === stage)!.doors;

    // The platform records that a booking was made and not whether anyone
    // turned up: no flag distinguishes a kept appointment from a missed one.
    // So the only doors that reach showed are the ones that reached sold, by
    // the funnel's own rule that a later stage implies the earlier ones.
    //
    // What must not happen is showed sitting above sold, which is what
    // promoting is_appointment into rank 4 would do: it would report every
    // booking as kept and hand the client a 100 percent show rate they have
    // never measured.
    expect(at('showed')).toBe(at('sold'));
    expect(at('booked')).toBeGreaterThanOrEqual(at('showed'));
  });

  it('keeps a do-not-knock door marked whatever its last visit said', async () => {
    const slice = await loadAllstar();
    const flagged = slice.properties.filter((p) => p.disposition === 'do_not_knock');
    expect(flagged.length).toBeGreaterThan(0);
  });

  it('answers empty for a client with no crew', async () => {
    await signIn('noah@letlois.com', 'whatever');
    const slice = await fetchFieldSalesFromPlatform('tn_beclinical');
    expect(slice.properties).toEqual([]);
    expect(slice.visits).toEqual([]);
    expect(slice.reps).toEqual([]);
    // The catalog still arrives: the tables are seeded into every tenant
    // database and stay inert, so an empty client is empty rather than broken.
    expect(slice.catalog.entries.length).toBeGreaterThan(1);
  });

  it('does not let one workspace’s doors answer for another', async () => {
    await signIn('noah@letlois.com', 'whatever');
    const [allstar, beclinical] = await Promise.all([
      fetchFieldSalesFromPlatform('tn_allstar'),
      fetchFieldSalesFromPlatform('tn_beclinical'),
    ]);
    expect(allstar.properties.length).toBeGreaterThan(0);
    expect(beclinical.properties).toEqual([]);
  });

  it('drops a knock whose address is not on the list', async () => {
    // Rather than pinning it to a placeholder door, which would put a tack on
    // the map at a house nobody visited.
    const slice = await loadAllstar();
    const ids = new Set(slice.properties.map((p) => p.id));
    for (const visit of slice.visits) {
      expect(ids.has(visit.propertyId)).toBe(true);
    }
  });
});
