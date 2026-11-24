// Apple Maps Ads against MOCK Apple Ads Platform API responses
// (test/fixtures/apple-maps-ads). No live Apple account is involved.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  AppleAdsClient,
  AppleAdsError,
  parsePrivateKey,
  sanitizeMessage,
  signClientSecret,
} from '../src/appleAdsClient';
import { appleMapsAdsConnector, monthWindow, readAppleMapsSettings, rowsToDaily, todayIn, type BrandsCampaignRow } from '../src/appleMapsAds';
import { adPlatformStatements } from '../src/adPlatformWriter';
import { costPer, rate, sumKnown } from '../src/adPlatform';
import { deriveIntegrationState } from '../src/integrationState';
import { CONNECTORS } from '../src/registry';
import { MOCK, appleAdsMock, mockCredentials, mockSigningKeys, reportFixtures } from './fixtures/apple-maps-ads';

let keys: Awaited<ReturnType<typeof mockSigningKeys>>;
beforeAll(async () => {
  keys = await mockSigningKeys();
});

const noSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

function b64urlDecode(part: string): Uint8Array {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function verifyJwt(jwt: string, publicPem: string): Promise<{ header: Record<string, unknown>; payload: Record<string, unknown>; valid: boolean }> {
  const [h, p, s] = jwt.split('.') as [string, string, string];
  const der = Uint8Array.from(atob(publicPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('spki', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  return {
    header: JSON.parse(new TextDecoder().decode(b64urlDecode(h))),
    payload: JSON.parse(new TextDecoder().decode(b64urlDecode(p))),
    valid,
  };
}

describe('Apple Ads authentication', () => {
  it('signs the client secret Apple documents: ES256, kid, sub/iss/aud, under 180 days', async () => {
    const creds = mockCredentials(keys.sec1.privateKey);
    const jwt = await signClientSecret(
      { clientId: creds.clientId!, teamId: creds.teamId!, keyId: creds.keyId!, privateKey: creds.privateKey! },
      1_800_000_000
    );
    const { header, payload, valid } = await verifyJwt(jwt, keys.sec1.publicKey);
    expect(valid).toBe(true);
    expect(header).toEqual({ alg: 'ES256', kid: creds.keyId });
    expect(payload).toEqual({ sub: creds.clientId, iss: creds.teamId, aud: 'https://appleid.apple.com', iat: 1_800_000_000, exp: 1_800_003_600 });
  });

  it('reads a SEC1 or PKCS#8 key, even pasted with its line breaks flattened or escaped', async () => {
    for (const pem of [
      keys.sec1.privateKey,
      keys.pkcs8.privateKey,
      keys.sec1.privateKey.replace(/\n/g, ''),
      keys.pkcs8.privateKey.replace(/\n/g, '\\n'),
    ]) {
      const jwt = await signClientSecret({ clientId: 'a', teamId: 'b', keyId: 'c', privateKey: pem }, 1);
      const pub = pem.includes('EC PRIVATE') ? keys.sec1.publicKey : keys.pkcs8.publicKey;
      expect((await verifyJwt(jwt, pub)).valid).toBe(true);
    }
    expect(parsePrivateKey(keys.sec1.privateKey).kind).toBe('sec1');
    expect(parsePrivateKey(keys.pkcs8.privateKey).kind).toBe('pkcs8');
  });

  it('refuses something that is not a key, as a configuration problem', async () => {
    await expect(signClientSecret({ clientId: 'a', teamId: 'b', keyId: 'c', privateKey: 'not a key' }, 1)).rejects.toMatchObject({
      failure: 'config',
    });
  });

  it('exchanges the secret for a token once, reuses it, and mints a new one after it expires', async () => {
    let now = 1_800_000_000_000;
    const mock = appleAdsMock();
    const client = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, {
      fetchImpl: mock.fetchImpl,
      now: () => now,
    });
    await client.get('/ad-accounts/' + MOCK.mapsAccountId);
    await client.get('/ad-accounts/' + MOCK.mapsAccountId);
    expect(client.tokensIssued).toBe(1);
    const tokenCall = mock.requests.find((r) => r.url.startsWith('https://appleid.apple.com'))!;
    expect(tokenCall.method).toBe('POST');
    const form = new URLSearchParams(String(tokenCall.body));
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('searchadsorg');
    expect(form.get('client_id')).toBe('SEARCHADS.00000000-mock-client');
    now += 3600_000;
    await client.get('/ad-accounts/' + MOCK.mapsAccountId);
    expect(client.tokensIssued).toBe(2);
  });

  it('refreshes the token once on a 401, and reports a second 401 as authentication', async () => {
    const once = appleAdsMock({
      override: {
        [`account:${MOCK.mapsAccountId}`]: [
          { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'token expired' } } },
          { status: 200, body: { result: { id: 1 } } },
        ],
      },
    });
    const c1 = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: once.fetchImpl });
    await expect(c1.get(`/ad-accounts/${MOCK.mapsAccountId}`)).resolves.toEqual({ result: { id: 1 } });
    expect(c1.tokensIssued).toBe(2);

    const always = appleAdsMock({ override: { [`account:${MOCK.mapsAccountId}`]: { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'nope' } } } } });
    const c2 = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: always.fetchImpl });
    await expect(c2.get(`/ad-accounts/${MOCK.mapsAccountId}`)).rejects.toMatchObject({ failure: 'auth', status: 401 });
  });

  it('says the credentials were refused when the token request fails', async () => {
    const mock = appleAdsMock({ override: { token: { status: 400, body: { error: 'invalid_client' } } } });
    const client = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, null, { fetchImpl: mock.fetchImpl });
    await expect(client.get('/acls', null)).rejects.toMatchObject({ failure: 'auth' });
  });
});

describe('Apple Ads requests', () => {
  it('scopes ad account calls with X-AP-Context and leaves it off /acls', async () => {
    const mock = appleAdsMock();
    const client = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: mock.fetchImpl });
    await client.get('/acls', null);
    await client.get(`/ad-accounts/${MOCK.mapsAccountId}`);
    const api = mock.requests.filter((r) => r.url.startsWith('https://api.ads.apple.com'));
    expect(api[0]!.headers['x-ap-context']).toBeUndefined();
    expect(api[1]!.headers['x-ap-context']).toBe(`adAccountId=${MOCK.mapsAccountId}`);
    expect(api[1]!.headers.authorization).toBe(`Bearer ${MOCK.token}`);
  });

  it('is read only: it refuses to POST anywhere but a /query endpoint', async () => {
    const client = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: appleAdsMock().fetchImpl });
    await expect(client.query('/campaigns', {})).rejects.toMatchObject({ failure: 'config' });
    await expect(client.query('/campaigns/123', { status: 'PAUSED' })).rejects.toBeInstanceOf(AppleAdsError);
  });

  it('waits Retry-After on a 429, then succeeds', async () => {
    const mock = appleAdsMock({
      override: {
        [`account:${MOCK.mapsAccountId}`]: [
          { status: 429, body: { error: { code: 'rate_limit_exceeded' } }, headers: { 'retry-after': '3' } },
          { status: 200, body: { result: { id: 1 } } },
        ],
      },
    });
    const { waits, sleep } = noSleep();
    const client = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: mock.fetchImpl, sleep });
    await client.get(`/ad-accounts/${MOCK.mapsAccountId}`);
    expect(waits).toEqual([3000]);
  });

  it('doubles the wait on consecutive 429s up to 16 seconds, then gives up as rate limited', async () => {
    const mock = appleAdsMock({ override: { [`account:${MOCK.mapsAccountId}`]: { status: 429, body: { error: { code: 'rate_limit_exceeded' } } } } });
    const { waits, sleep } = noSleep();
    const client = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: mock.fetchImpl, sleep });
    await expect(client.get(`/ad-accounts/${MOCK.mapsAccountId}`)).rejects.toMatchObject({ failure: 'rate_limited' });
    expect(waits).toEqual([2000, 4000, 8000, 16000, 16000]);
  });

  it('paces itself when RateLimit-Remaining runs low', async () => {
    const mock = appleAdsMock({
      override: { [`account:${MOCK.mapsAccountId}`]: { status: 200, body: { result: {} }, headers: { 'ratelimit-remaining': '2', 'ratelimit-reset': '7' } } },
    });
    const { waits, sleep } = noSleep();
    const client = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: mock.fetchImpl, sleep });
    await client.get(`/ad-accounts/${MOCK.mapsAccountId}`);
    expect(waits).toEqual([7000]);
  });

  it('retries a 5xx with backoff before succeeding', async () => {
    const mock = appleAdsMock({
      override: {
        [`account:${MOCK.mapsAccountId}`]: [
          { status: 500, body: { error: { code: 'internal_server_error' } } },
          { status: 503, body: {} },
          { status: 200, body: { result: { id: 1 } } },
        ],
      },
    });
    const { waits, sleep } = noSleep();
    const client = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: mock.fetchImpl, sleep });
    await expect(client.get(`/ad-accounts/${MOCK.mapsAccountId}`)).resolves.toEqual({ result: { id: 1 } });
    expect(waits).toEqual([2000, 4000]);
  });

  it('classifies 403 as permission and 400 as a bad request, with Apple’s code and no token', async () => {
    const forbidden = appleAdsMock({ override: { [`account:${MOCK.mapsAccountId}`]: { status: 403, body: { error: { code: 'FORBIDDEN', message: 'Insufficient role' } } } } });
    const c1 = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: forbidden.fetchImpl });
    const e1 = await c1.get(`/ad-accounts/${MOCK.mapsAccountId}`).catch((e) => e);
    expect(e1).toMatchObject({ failure: 'permission', status: 403 });
    expect(e1.message).toContain('FORBIDDEN');
    expect(e1.message).not.toContain(MOCK.token);

    const bad = appleAdsMock({
      override: { campaigns: { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Validation errors found', details: [{ code: 'INVALID_DATE_RANGE', message: 'too long' }] } } } },
    });
    const c2 = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: bad.fetchImpl });
    const e2 = await c2.reportRows('/reports/business-brands/campaigns/query', {}).catch((e) => e);
    expect(e2).toMatchObject({ failure: 'bad_request' });
    expect(e2.message).toContain('INVALID_DATE_RANGE');
  });

  it('never lets something token shaped into an error message', () => {
    const leaked = sanitizeMessage(`Bearer ${'x'.repeat(80)} and eyJhbGciOiJFUzI1NiIsImtpZCI6Im1vY2sifQ.eyJzdWIiOiJtb2NrIn0.sig`);
    expect(leaked).not.toMatch(/x{40}/);
    expect(leaked).not.toContain('eyJhbGci');
  });

  it('pages through a report until totalCount is reached', async () => {
    const page = (n: number, start: number) => ({ result: { rows: Array.from({ length: n }, (_, i) => ({ metadata: { id: start + i } })) }, pagination: { totalCount: 3 } });
    const mock = appleAdsMock({ override: { campaigns: [{ status: 200, body: page(2, 0) }, { status: 200, body: page(1, 2) }] } });
    const client = new AppleAdsClient(mockCredentials(keys.sec1.privateKey) as never, MOCK.mapsAccountId, { fetchImpl: mock.fetchImpl });
    const rows = await client.reportRows<{ metadata: { id: number } }>('/reports/business-brands/campaigns/query', {}, 2);
    expect(rows.map((r) => r.metadata.id)).toEqual([0, 1, 2]);
    const offsets = mock.requests.filter((r) => r.url.includes('/reports/')).map((r) => (r.body as { pagination: { offset: number } }).pagination.offset);
    expect(offsets).toEqual([0, 2]);
  });
});

describe('Apple Maps normalisation', () => {
  const range = { from: '2026-10-01', to: '2026-10-31' };

  it('keeps only BUSINESS_BRAND campaigns, one row per campaign per day', () => {
    const { daily, campaigns, skipped } = rowsToDaily(reportFixtures.campaigns.result.rows as BrandsCampaignRow[], 'campaign', range, 'USD', null);
    expect(skipped).toBe(1);
    expect([...campaigns.keys()]).toEqual([String(MOCK.campaignDowntown), String(MOCK.campaignHome)]);
    expect(daily).toHaveLength(3);
    expect(daily[1]).toMatchObject({ date: '2026-10-02', spend: 30, impressions: 1500, clicks: 60, conversions: 9, dimension: '' });
    expect(daily[1]!.conversionDetail).toMatchObject({ getDirections: 5, call: 3, tapURL: 1, share: null });
  });

  it('records no actions as unknown, not zero', () => {
    const { daily } = rowsToDaily(reportFixtures.campaigns.result.rows as BrandsCampaignRow[], 'campaign', range, 'USD', null);
    const home = daily.find((d) => d.campaignId === String(MOCK.campaignHome))!;
    expect(home.conversions).toBeNull();
    expect(home.conversionDetail!.getDirections).toBeNull();
  });

  it('narrows to one brand when the account carries more than one', () => {
    const { campaigns } = rowsToDaily(reportFixtures.campaigns.result.rows as BrandsCampaignRow[], 'campaign', range, 'USD', MOCK.otherBrandId);
    expect(campaigns.size).toBe(0);
  });

  it('uses totalMetrics as the day for a single day request', () => {
    const rows = [{ metadata: { id: 1, promotedObjectType: 'BUSINESS_BRAND' }, totalMetrics: { localSpend: { amount: '4.50', currency: 'USD' }, impressions: 10, taps: 2 } }];
    const { daily } = rowsToDaily(rows, 'campaign', { from: '2026-10-05', to: '2026-10-05' }, 'USD', null);
    expect(daily).toEqual([expect.objectContaining({ date: '2026-10-05', spend: 4.5, impressions: 10, clicks: 2 })]);
  });

  it('cuts a month at today in the account’s timezone', () => {
    expect(monthWindow('2026-10', '2026-11-24')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthWindow('2026-11', '2026-11-24')).toEqual({ from: '2026-11-01', to: '2026-11-24' });
    expect(monthWindow('2026-12', '2026-11-24')).toBeNull();
    // 03:00 UTC on the 1st is still the previous day in Phoenix.
    expect(todayIn('America/Phoenix', Date.parse('2026-12-01T03:00:00Z'))).toBe('2026-11-30');
  });

  it('derives ratios from sums and answers N/A, never zero, with nothing to divide by', () => {
    expect(rate(4, 100)).toBe(0.04);
    expect(rate(0, 0)).toBeNull();
    expect(costPer(60, 100)).toBe(0.6);
    expect(costPer(10, 0)).toBeNull();
    expect(costPer(10, null)).toBeNull();
    expect(sumKnown([null, null])).toBeNull();
    expect(sumKnown([null, 3, 4])).toBe(7);
  });

  it('writes one row per key even if Apple repeats a row across pages', () => {
    const row = { date: '2026-10-01', campaignId: '1', breakdown: 'campaign' as const, dimension: '', currency: 'USD', spend: 1, impressions: 1, clicks: 1, conversions: null, conversionDetail: null };
    const { dailyRows, statements } = adPlatformStatements({
      platform: 'apple_maps',
      accountId: '1',
      range: { from: '2026-10-01', to: '2026-10-31' },
      campaigns: [],
      daily: [row, { ...row, spend: 2 }],
      locations: [],
    });
    expect(dailyRows).toBe(1);
    const insert = statements.find((s) => s.sql.includes('INSERT INTO ad_platform_daily'))!;
    expect(JSON.parse(String(insert.params[2]))).toEqual([expect.objectContaining({ spend: 2 })]);
    // Every statement stays well under D1's 100 bound parameter limit.
    expect(statements.every((s) => s.params.length <= 100)).toBe(true);
  });
});

describe('Apple Maps connector', () => {
  it('is registered, read only, and asks for the right things', () => {
    expect(CONNECTORS['apple-maps-ads']).toBe(appleMapsAdsConnector);
    const req = appleMapsAdsConnector.getRequirements();
    expect(req.authKind).toBe('oauth2');
    expect(req.credentialFields.find((f) => f.key === 'privateKey')).toMatchObject({ secret: true });
    expect(req.credentialFields.map((f) => f.key)).toEqual(['clientId', 'teamId', 'keyId', 'privateKey', 'adAccountId', 'brandId', 'backfillDays']);
    expect(appleMapsAdsConnector.backfillDays!({})).toBe(90);
    expect(appleMapsAdsConnector.backfillDays!({ ...mockCredentials('k'), backfillDays: '30' })).toBe(30);
  });

  it('validates settings before calling Apple', () => {
    expect(readAppleMapsSettings({}).ok).toBe(false);
    expect(readAppleMapsSettings({ ...mockCredentials('k'), adAccountId: 'act_1' }).ok).toBe(false);
    expect(readAppleMapsSettings({ ...mockCredentials('k'), backfillDays: '900' }).ok).toBe(false);
    expect(readAppleMapsSettings({ ...mockCredentials('k'), adAccountId: '' })).toMatchObject({ ok: true, value: { adAccountId: '' } });
  });

  it('lists the accessible accounts when none is chosen yet, and never picks one itself', async () => {
    const mock = appleAdsMock();
    const result = await appleMapsAdsConnector.testConnection(mockCredentials(keys.sec1.privateKey, { adAccountId: '' }), { fetchImpl: mock.fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.planCheck).toMatchObject({
      failureKind: 'select_account',
      accounts: [
        { id: MOCK.mapsAccountId, appleMaps: true },
        { id: MOCK.appStoreAccountId, appleMaps: false },
      ],
    });
    expect(result.message).toContain(MOCK.mapsAccountId);
    expect(result.message).not.toContain(MOCK.appStoreAccountId);
  });

  it('passes for an Apple Maps account the user can read, and notes a read only role is enough', async () => {
    const result = await appleMapsAdsConnector.testConnection(mockCredentials(keys.sec1.privateKey), { fetchImpl: appleAdsMock().fetchImpl });
    expect(result).toMatchObject({
      ok: true,
      connectedAs: `[MOCK] Demo Brand Maps (${MOCK.mapsAccountId})`,
      planCheck: { leastPrivilege: true, brands: [{ id: MOCK.brandId }], adAccount: { currency: 'USD', timezone: 'America/Phoenix' } },
    });
  });

  it('refuses an App Store ads account', async () => {
    const result = await appleMapsAdsConnector.testConnection(mockCredentials(keys.sec1.privateKey, { adAccountId: MOCK.appStoreAccountId }), {
      fetchImpl: appleAdsMock().fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, failure: 'insufficient_plan', planCheck: { failureKind: 'permission' } });
    expect(result.message).toContain('not an Apple Maps account');
  });

  it('refuses an account this API user cannot see, and a brand not delegated to the account', async () => {
    const unseen = await appleMapsAdsConnector.testConnection(mockCredentials(keys.sec1.privateKey, { adAccountId: '3333333333' }), {
      fetchImpl: appleAdsMock().fetchImpl,
    });
    expect(unseen).toMatchObject({ ok: false, failure: 'insufficient_plan', planCheck: { failureKind: 'permission' } });
    const brand = await appleMapsAdsConnector.testConnection(mockCredentials(keys.sec1.privateKey, { brandId: MOCK.otherBrandId }), {
      fetchImpl: appleAdsMock().fetchImpl,
    });
    expect(brand).toMatchObject({ ok: false, failure: 'insufficient_plan' });
  });

  it('reports refused credentials as an authentication failure', async () => {
    const mock = appleAdsMock({ override: { token: { status: 401, body: { error: 'invalid_client' } } } });
    const result = await appleMapsAdsConnector.testConnection(mockCredentials(keys.sec1.privateKey), { fetchImpl: mock.fetchImpl });
    expect(result).toMatchObject({ ok: false, failure: 'bad_credentials', planCheck: { failureKind: 'auth' } });
  });
});

describe('integration states', () => {
  const base = { hasCredentials: true, status: 'connected', enabled: 1, lastSyncAt: '2026-11-01T00:00:00Z', lastSyncResult: null, planCheck: null };
  it('names every state the spec lists', () => {
    expect(deriveIntegrationState({ ...base, hasCredentials: false })).toBe('not_connected');
    expect(deriveIntegrationState({ ...base, status: 'disconnected', lastSyncAt: null })).toBe('pending');
    expect(deriveIntegrationState({ ...base, lastSyncAt: null })).toBe('connected');
    expect(deriveIntegrationState({ ...base, running: true })).toBe('syncing');
    expect(deriveIntegrationState({ ...base, lastSyncResult: JSON.stringify({ ok: true, stats: { campaigns: 2 } }) })).toBe('synced');
    expect(deriveIntegrationState({ ...base, lastSyncResult: JSON.stringify({ ok: true, stats: { campaigns: 0 } }) })).toBe('no_campaigns');
    const failed = (failure: string) => JSON.stringify({ ok: false, failure, at: '2026-11-02T00:00:00Z' });
    expect(deriveIntegrationState({ ...base, status: 'error', lastSyncResult: failed('permission') })).toBe('permission_required');
    expect(deriveIntegrationState({ ...base, status: 'error', lastSyncResult: failed('auth') })).toBe('auth_expired');
    expect(deriveIntegrationState({ ...base, status: 'error', lastSyncResult: failed('server') })).toBe('sync_failed');
    expect(deriveIntegrationState({ ...base, enabled: 0 })).toBe('disabled');
  });

  it('lets the most recent of a failed test and a failed sync decide', () => {
    const r = JSON.stringify({ ok: false, failure: 'server', at: '2026-11-01T00:00:00Z' });
    const p = JSON.stringify({ failureKind: 'auth', checkedAt: '2026-11-02T00:00:00Z' });
    expect(deriveIntegrationState({ ...base, status: 'error', lastSyncResult: r, planCheck: p })).toBe('auth_expired');
    const older = JSON.stringify({ failureKind: 'auth', checkedAt: '2026-10-01T00:00:00Z' });
    expect(deriveIntegrationState({ ...base, status: 'error', lastSyncResult: r, planCheck: older })).toBe('sync_failed');
  });
});
