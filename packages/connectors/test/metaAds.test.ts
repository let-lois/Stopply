import { describe, it, expect } from 'vitest';
import { fetchMetaCampaignSpend, fetchMetaAdLineItems, testMetaConnection } from '../src/metaAds';

function fakeFetch(routes: Array<{ match: RegExp; status: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const route of routes) {
      if (route.match.test(url)) {
        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

describe('fetchMetaCampaignSpend', () => {
  it('maps campaign insights to AdSpendRow, summing lead-shaped actions', async () => {
    const result = await fetchMetaCampaignSpend(
      'token',
      '4048063365418328',
      '2026-06',
      fakeFetch([
        {
          match: /insights/,
          status: 200,
          body: {
            data: [
              {
                campaign_name: 'MAG | Lead Generation',
                spend: '24740.25',
                actions: [
                  { action_type: 'lead', value: '600' },
                  { action_type: 'onsite_conversion.lead_grouped', value: '27' },
                  { action_type: 'link_click', value: '9104' },
                ],
              },
              { campaign_name: 'Paused Campaign', spend: '0' },
            ],
          },
        },
      ])
    );
    expect(result.kind).toBe('ad-spend');
    expect(result.adSpend).toEqual([
      { periodMonth: '2026-06', channel: 'Meta', campaign: 'MAG | Lead Generation', spend: 24740.25, leadsReported: 627 },
      { periodMonth: '2026-06', channel: 'Meta', campaign: 'Paused Campaign', spend: 0, leadsReported: null },
    ]);
    expect(result.recordsFrom).toBe('2026-06-01');
    expect(result.recordsThrough).toBe('2026-06-30');
  });

  it('follows pagination and throws on a Meta API error', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      calls++;
      const url = String(input);
      if (url.includes('page2')) {
        return new Response(JSON.stringify({ data: [{ campaign_name: 'B', spend: '5' }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ data: [{ campaign_name: 'A', spend: '10' }], paging: { next: 'https://graph.facebook.com/page2' } }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await fetchMetaCampaignSpend('token', '123', '2026-06', fetchImpl);
    expect(calls).toBe(2);
    expect(result.adSpend).toHaveLength(2);
  });

  it('throws a readable error when Meta rejects the token', async () => {
    await expect(
      fetchMetaCampaignSpend(
        'bad-token',
        '123',
        '2026-06',
        fakeFetch([{ match: /insights/, status: 200, body: { error: { code: 190, message: 'Invalid OAuth access token' } } }])
      )
    ).rejects.toThrow('Invalid OAuth access token');
  });
});

describe('fetchMetaAdLineItems', () => {
  it('maps ad-level insights to AdLineItemRow with a null creative type', async () => {
    const result = await fetchMetaAdLineItems(
      'token',
      '4048063365418328',
      '2026-06',
      fakeFetch([
        {
          match: /insights/,
          status: 200,
          body: {
            data: [
              {
                campaign_name: 'MAG | Lead Generation',
                ad_id: '123',
                ad_name: 'Video Ad 1',
                spend: '1000',
                actions: [{ action_type: 'lead', value: '20' }],
              },
            ],
          },
        },
      ])
    );
    expect(result.kind).toBe('ad-line-items');
    expect(result.adLineItems).toEqual([
      {
        periodMonth: '2026-06',
        channel: 'Meta',
        campaign: 'MAG | Lead Generation',
        adName: 'Video Ad 1',
        adId: '123',
        creativeType: null,
        spend: 1000,
        leadsReported: 20,
      },
    ]);
  });
});

describe('testMetaConnection', () => {
  it('returns the account name on success', async () => {
    const result = await testMetaConnection(
      'token',
      '4048063365418328',
      fakeFetch([{ match: /act_/, status: 200, body: { name: 'Be CLINICAL San Ramon' } }])
    );
    expect(result).toMatchObject({ ok: true, accountName: 'Be CLINICAL San Ramon' });
  });

  it('surfaces the Meta error message on failure', async () => {
    const result = await testMetaConnection(
      'bad-token',
      '123',
      fakeFetch([{ match: /act_/, status: 200, body: { error: { message: 'Invalid OAuth access token' } } }])
    );
    expect(result).toMatchObject({ ok: false, message: 'Invalid OAuth access token' });
  });
});
