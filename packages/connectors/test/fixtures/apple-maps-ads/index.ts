// MOCK APPLE ADS PLATFORM API FIXTURES. TEST ONLY.
//
// Every name, id and number here is invented. They are shaped after the
// examples in Apple's Apple Ads Platform API documentation (API 1.0) and
// exist so the Apple Maps integration can be built and tested before any
// live account is authorised. Nothing outside a test directory may import
// this file, and test/no-mock-in-src.test.ts fails if anything does: mock
// figures must never be shown as a client's real advertising performance.

export const MOCK = {
  token: 'mock-access-token-not-a-real-apple-token',
  orgId: 99000001,
  mapsAccountId: '1234567890',
  appStoreAccountId: '2222222222',
  brandId: '9000000001',
  otherBrandId: '9000000002',
  campaignDowntown: 7000001,
  campaignHome: 7000002,
  campaignAppStore: 7000099,
  locationDowntown: '8000001',
  locationUptown: '8000002',
  locationUnused: '8000003',
} as const;

const usd = (amount: string) => ({ amount, currency: 'USD' });

export const accountFixtures = {
  acls: {
    result: {
      acls: [
        { adAccount: { id: Number(MOCK.mapsAccountId), name: '[MOCK] Demo Brand Maps', orgId: MOCK.orgId }, roles: ['API Account Read Only'] },
        { adAccount: { id: Number(MOCK.appStoreAccountId), name: '[MOCK] Demo App Store', orgId: MOCK.orgId }, roles: ['API Account Manager'] },
      ],
    },
  },
  mapsAccount: {
    result: {
      id: Number(MOCK.mapsAccountId),
      name: '[MOCK] Demo Brand Maps',
      orgId: MOCK.orgId,
      timezone: 'America/Phoenix',
      currency: 'USD',
      paymentModel: 'PAYG',
      systemStatus: 'ACTIVE',
      productFeatures: ['BUSINESS_BRAND_MANUAL'],
      delegations: [{ resourceId: MOCK.brandId, resourceType: 'BUSINESS_BRAND', resourceName: '[MOCK] Demo Brand' }],
    },
  },
  appStoreAccount: {
    result: {
      id: Number(MOCK.appStoreAccountId),
      name: '[MOCK] Demo App Store',
      orgId: MOCK.orgId,
      timezone: 'America/New_York',
      currency: 'USD',
      systemStatus: 'ACTIVE',
      productFeatures: ['APPSTORE_APP_MANUAL'],
      delegations: [{ resourceId: '12345678', resourceType: 'CONTENT_PROVIDER', resourceName: '[MOCK] Demo Apps' }],
    },
  },
};

const downtownMeta = {
  id: MOCK.campaignDowntown,
  name: '[MOCK] Maps Search Downtown',
  adAccountId: Number(MOCK.mapsAccountId),
  promotedObjectType: 'BUSINESS_BRAND',
  promotedObjectId: MOCK.brandId,
  promotedObject: { name: '[MOCK] Demo Brand' },
  status: 'ENABLED',
  displayStatus: 'RUNNING',
  systemStatus: 'RUNNING',
  deleted: false,
  billingEvent: 'TAPS',
  dailyBudget: { value: usd('50.00') },
  startTime: '2026-09-01T08:00:00.000',
  targeting: { supplySource: { include: ['MAPS'] }, supplyPlacement: { include: ['MAPS_SEARCH_RESULTS', 'MAPS_SEARCH_HOME'] } },
};

const homeMeta = {
  id: MOCK.campaignHome,
  name: '[MOCK] Maps Home Brand',
  adAccountId: Number(MOCK.mapsAccountId),
  promotedObjectType: 'BUSINESS_BRAND',
  promotedObjectId: MOCK.brandId,
  status: 'PAUSED',
  displayStatus: 'PAUSED',
  systemStatus: 'NOT_RUNNING',
  deleted: false,
  dailyBudget: { value: usd('20.00') },
};

// Not something the business brands endpoint should ever return. Here to
// prove an App Store row would be refused if it did.
const appStoreMeta = { id: MOCK.campaignAppStore, name: '[MOCK] App Store Campaign', promotedObjectType: 'APPSTORE_APP', promotedObjectId: '555' };

const day = (date: string, spend: string, impressions: number, taps: number, actions?: Record<string, number>) => ({
  date,
  localSpend: usd(spend),
  impressions,
  taps,
  ...(actions ? Object.fromEntries(Object.entries(actions).map(([k, v]) => [k, { tap: v }])) : {}),
});

// October 2026. Totals across the campaign cut:
//   spend 60.00, impressions 2500, taps 100, actions 15 (Home reports none)
export const reportFixtures = {
  campaigns: {
    result: {
      rows: [
        {
          metadata: downtownMeta,
          totalMetrics: day('', '50.00', 2500, 100, { actions: 15, getDirections: 9, call: 5, tapURL: 1 }),
          granularMetrics: [
            day('2026-10-01', '20.00', 1000, 40, { actions: 6, getDirections: 4, call: 2 }),
            day('2026-10-02', '30.00', 1500, 60, { actions: 9, getDirections: 5, call: 3, tapURL: 1 }),
          ],
        },
        {
          metadata: homeMeta,
          totalMetrics: day('', '10.00', 0, 0),
          granularMetrics: [day('2026-10-01', '10.00', 0, 0)],
        },
        { metadata: appStoreMeta, totalMetrics: day('', '999.00', 99999, 9999), granularMetrics: [day('2026-10-01', '999.00', 99999, 9999)] },
      ],
    },
    pagination: { offset: 0, pageSize: 1000, totalCount: 3 },
  },
  byLocation: {
    result: {
      rows: [
        {
          metadata: { ...downtownMeta, locationId: MOCK.locationDowntown },
          granularMetrics: [day('2026-10-01', '12.00', 600, 25, { actions: 4 }), day('2026-10-02', '18.00', 900, 36, { actions: 5 })],
        },
        {
          metadata: { ...downtownMeta, locationId: MOCK.locationUptown },
          granularMetrics: [day('2026-10-01', '8.00', 400, 15, { actions: 2 }), day('2026-10-02', '12.00', 600, 24, { actions: 4 })],
        },
        { metadata: { ...homeMeta, locationId: MOCK.locationDowntown }, granularMetrics: [day('2026-10-01', '10.00', 0, 0)] },
      ],
    },
    pagination: { offset: 0, pageSize: 1000, totalCount: 3 },
  },
  byPlacement: {
    result: {
      rows: [
        {
          metadata: { ...downtownMeta, supplyPlacement: 'MAPS_SEARCH_RESULTS' },
          granularMetrics: [day('2026-10-01', '20.00', 1000, 40, { actions: 6 }), day('2026-10-02', '25.00', 1200, 50, { actions: 7 })],
        },
        { metadata: { ...downtownMeta, supplyPlacement: 'MAPS_SEARCH_HOME' }, granularMetrics: [day('2026-10-02', '5.00', 300, 10, { actions: 2 })] },
        { metadata: { ...homeMeta, supplyPlacement: 'MAPS_SEARCH_HOME' }, granularMetrics: [day('2026-10-01', '10.00', 0, 0)] },
      ],
    },
    pagination: { offset: 0, pageSize: 1000, totalCount: 3 },
  },
  ads: {
    result: {
      rows: [
        {
          metadata: { id: 7100001, name: '[MOCK] Downtown creative A', campaignId: MOCK.campaignDowntown, adGroupId: 7200001, creative: { id: 1, creativeType: 'BRAND_CARD' } },
          totalMetrics: day('', '50.00', 2500, 100, { actions: 15 }),
        },
        {
          metadata: { id: 7100002, name: '[MOCK] Home creative', campaignId: MOCK.campaignHome, adGroupId: 7200002, creative: { id: 2, creativeType: 'BRAND_CARD' } },
          totalMetrics: day('', '10.00', 0, 0),
        },
        { metadata: { id: 7100099, name: '[MOCK] App Store ad', campaignId: MOCK.campaignAppStore }, totalMetrics: day('', '999.00', 1, 1) },
      ],
    },
    pagination: { offset: 0, pageSize: 1000, totalCount: 3 },
  },
  locations: {
    result: [
      { id: MOCK.locationDowntown, brandId: MOCK.brandId, name: '[MOCK] Demo Brand Downtown', status: 'OPEN', address: { locality: 'Phoenix', adminArea: 'Arizona', countryOrRegion: 'US', fullAddress: '1 Mock St' } },
      { id: MOCK.locationUptown, brandId: MOCK.brandId, name: '[MOCK] Demo Brand Uptown', status: 'OPEN', address: { locality: 'Phoenix', adminArea: 'Arizona', countryOrRegion: 'US' } },
      { id: MOCK.locationUnused, brandId: MOCK.brandId, name: '[MOCK] Demo Brand Closed', status: 'CLOSED', address: { locality: 'Tempe', adminArea: 'Arizona', countryOrRegion: 'US' } },
    ],
    pagination: { offset: 0, pageSize: 1000, totalCount: 3 },
  },
  empty: { result: {}, pagination: { offset: 0, pageSize: 1000, totalCount: 0 } },
};

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface AppleMockOptions {
  // Replace any route's answer. Keys: token, acls, account:<id>, campaigns,
  // byLocation, byPlacement, ads, locations.
  override?: Partial<Record<string, { status: number; body: unknown; headers?: Record<string, string> } | Array<{ status: number; body: unknown; headers?: Record<string, string> }>>>;
  currency?: string;
  noCampaigns?: boolean;
}

// A fetch that answers like the Apple endpoints this integration calls, and
// records every request. Anything it does not recognise is a 404, so a test
// notices a call nobody expected.
export function appleAdsMock(options: AppleMockOptions = {}) {
  const requests: RecordedRequest[] = [];
  const counters = new Map<string, number>();
  const answer = (route: string, fallback: { status: number; body: unknown; headers?: Record<string, string> }) => {
    const o = options.override?.[route];
    if (!o) return fallback;
    if (Array.isArray(o)) {
      const i = counters.get(route) ?? 0;
      counters.set(route, i + 1);
      return o[Math.min(i, o.length - 1)]!;
    }
    return o;
  };
  const respond = (r: { status: number; body: unknown; headers?: Record<string, string> }) =>
    new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    let body: unknown = init?.body ?? null;
    if (typeof body === 'string' && headers['content-type']?.includes('json')) body = JSON.parse(body);
    requests.push({ method, url, headers, body });

    if (url.startsWith('https://appleid.apple.com/auth/oauth2/token')) {
      return respond(answer('token', { status: 200, body: { access_token: MOCK.token, token_type: 'Bearer', expires_in: 3600, scope: 'searchadsorg' } }));
    }
    const path = url.replace('https://api.ads.apple.com/v1', '');
    if (path === '/acls') return respond(answer('acls', { status: 200, body: accountFixtures.acls }));
    const account = /^\/ad-accounts\/(\d+)$/.exec(path);
    if (account) {
      const id = account[1]!;
      const base = id === MOCK.mapsAccountId ? accountFixtures.mapsAccount : id === MOCK.appStoreAccountId ? accountFixtures.appStoreAccount : null;
      if (!base) return respond(answer(`account:${id}`, { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Ad account not found' } } }));
      const withCurrency = options.currency ? { result: { ...base.result, currency: options.currency } } : base;
      return respond(answer(`account:${id}`, { status: 200, body: withCurrency }));
    }
    if (path === '/reports/business-brands/campaigns/query') {
      const groupBy = (body as { groupBy?: string[] } | null)?.groupBy ?? [];
      const key = groupBy.includes('locationId') ? 'byLocation' : groupBy.includes('supplyPlacement') ? 'byPlacement' : 'campaigns';
      const fixture = options.noCampaigns ? reportFixtures.empty : reportFixtures[key];
      return respond(answer(key, { status: 200, body: fixture }));
    }
    if (path === '/reports/business-brands/ads/query') {
      return respond(answer('ads', { status: 200, body: options.noCampaigns ? reportFixtures.empty : reportFixtures.ads }));
    }
    if (path === '/locations/query') return respond(answer('locations', { status: 200, body: reportFixtures.locations }));
    return respond({ status: 404, body: { error: { code: 'NOT_FOUND', message: `mock has no route for ${method} ${path}` } } });
  }) as typeof fetch;

  return { fetchImpl, requests };
}

// A real P-256 key pair in the two PEM shapes Apple's guide can produce, so
// signing is tested for real rather than stubbed.
export async function mockSigningKeys() {
  const { generateKeyPairSync } = await import('node:crypto');
  const sec1 = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const pkcs8 = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { sec1, pkcs8 };
}

export function mockCredentials(privateKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    clientId: 'SEARCHADS.00000000-mock-client',
    teamId: 'SEARCHADS.00000000-mock-team',
    keyId: '00000000-0000-0000-0000-00000000mock',
    privateKey,
    adAccountId: MOCK.mapsAccountId,
    ...extra,
  };
}
