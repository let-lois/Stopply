// Provider neutral shapes for ad platforms that report more than spend.
//
// Meta keeps its own path (metaAds.ts writes raw_ad_spend and ad_line_items
// directly) and is deliberately not rewritten onto this. Apple Maps is the
// first platform built on it. TikTok and Microsoft Advertising (Bing) are
// meant to be the next: each implements AdPlatformProvider, maps its report
// rows into these shapes, and gets the storage, the sync history, the
// dashboard report and the integration states without new plumbing.
//
// Equivalent metrics share a column (clicks holds Apple's taps, TikTok's
// clicks, Bing's clicks) but never lose their platform meaning: the
// descriptor names each one the way its platform does, and conversions are
// never added across platforms, because "an Apple Maps action" and "a
// TikTok conversion" are counted under different attribution rules.

export type AdPlatformId = 'apple_maps';

export interface AdPlatformDescriptor {
  id: AdPlatformId;
  // The integrations.provider value that feeds this platform.
  provider: string;
  displayName: string;
  // The raw_ad_spend.channel spend is filed under, so it joins the monthly
  // rollup and every cross platform report beside Meta and Google.
  channel: string;
  labels: { clicks: string; clickRate: string; costPerClick: string; conversions: string };
  // Plain language definitions, shown wherever the numbers are.
  definitions: Array<{ term: string; meaning: string }>;
  // What the platform's own breakdowns are called, if it has them.
  breakdowns: Array<'location' | 'placement'>;
}

export const AD_PLATFORMS: Record<AdPlatformId, AdPlatformDescriptor> = {
  apple_maps: {
    id: 'apple_maps',
    provider: 'apple-maps-ads',
    displayName: 'Apple Maps Ads',
    channel: 'Apple Maps',
    labels: { clicks: 'Taps', clickRate: 'TTR', costPerClick: 'Avg. CPT', conversions: 'Actions' },
    definitions: [
      { term: 'Spend', meaning: 'What Apple charged for the ads, in the ad account’s currency, as Apple reports it (localSpend).' },
      { term: 'Impressions', meaning: 'Times an ad was shown on Apple Maps.' },
      { term: 'Taps', meaning: 'Taps on the ad.' },
      { term: 'TTR', meaning: 'Tap-through rate: taps ÷ impressions. N/A with no impressions.' },
      { term: 'Avg. CPT', meaning: 'Average cost per tap: spend ÷ taps. N/A with no taps.' },
      {
        term: 'Actions',
        meaning:
          'Apple Maps actions Apple attributes to an ad tap: directions, calls, website taps, shares, Get the App and photo gallery engagement. Apple’s count, under Apple’s attribution. Not leads, and not comparable to Meta or Google conversions.',
      },
      { term: 'Cost per action', meaning: 'Spend ÷ actions. N/A with no actions.' },
    ],
    breakdowns: ['location', 'placement'],
  },
};

export function adPlatformById(id: string): AdPlatformDescriptor | null {
  return (AD_PLATFORMS as Record<string, AdPlatformDescriptor>)[id] ?? null;
}

export interface NormalizedCampaign {
  campaignId: string;
  name: string;
  status: string | null;
  displayStatus: string | null;
  // The brand id for Apple Maps.
  promotedObjectId: string | null;
  currency: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  startTime: string | null;
  endTime: string | null;
  deleted: boolean;
}

export interface NormalizedLocation {
  locationId: string;
  brandId: string | null;
  name: string | null;
  locality: string | null;
  adminArea: string | null;
  country: string | null;
  status: string | null;
}

export type DailyBreakdown = 'campaign' | 'location' | 'placement';

export interface NormalizedDailyMetric {
  date: string;
  campaignId: string;
  breakdown: DailyBreakdown;
  // '' for the campaign cut, the location id or placement otherwise.
  dimension: string;
  currency: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  // Null when the platform reported no conversion figure for the row.
  conversions: number | null;
  // The platform's own conversion breakdown, under its own names. A null
  // value means "not reported", which is not zero.
  conversionDetail: Record<string, number | null> | null;
}

export interface AdPlatformSnapshot {
  platform: AdPlatformId;
  accountId: string;
  range: { from: string; to: string };
  campaigns: NormalizedCampaign[];
  daily: NormalizedDailyMetric[];
  locations: NormalizedLocation[];
}

export interface AdAccountSummary {
  id: string;
  name: string;
  roles: string[];
  // True when the account can run campaigns on this platform.
  eligible: boolean;
}

export interface AdPlatformHealth {
  ok: boolean;
  failure?: 'auth' | 'permission' | 'select_account' | 'error';
  message?: string;
  accountName?: string;
  accounts?: AdAccountSummary[];
}

// The operations every reporting provider offers, where its platform allows.
// Read only on purpose: there is no create, update, pause or delete.
export interface AdPlatformProvider<Creds> {
  platform: AdPlatformId;
  checkHealth(creds: Creds): Promise<AdPlatformHealth>;
  listAccounts(creds: Creds): Promise<AdAccountSummary[]>;
  // Campaigns, daily metrics and locations for an inclusive date range.
  fetchSnapshot(creds: Creds, range: { from: string; to: string }): Promise<AdPlatformSnapshot>;
}

/* ------------------------------------------------------------------ */
/* derived metrics: N/A, never a made up zero                          */
/* ------------------------------------------------------------------ */

const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return round(numerator / denominator, 6);
}

export function costPer(spend: number | null, count: number | null): number | null {
  if (spend === null || count === null || count <= 0) return null;
  return round(spend / count, 4);
}

// Sums what was reported. All missing stays missing; a mix sums the known.
export function sumKnown(values: Array<number | null | undefined>): number | null {
  let seen = false;
  let total = 0;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      seen = true;
      total += v;
    }
  }
  return seen ? round(total, 4) : null;
}
