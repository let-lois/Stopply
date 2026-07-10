// Fabricated data for preview demo mode (see demoMode.ts). Fictional
// clients with plausible but made up Meta/Google numbers, not real
// client data, not copied from any actual tenant.

import type { Me } from './api';
import type { AdLineItem, CampaignMetrics, ChannelMetrics, MonthData, SourceInfo, TenantSettings } from './types';

interface DemoClient {
  id: string;
  slug: string;
  name: string;
  plan: 'starter' | 'pro' | 'whitelabel';
  timezone: string;
  platforms: Array<'meta' | 'google'>;
  monthlyBudget: number;
  platformBudgets: Partial<Record<'meta' | 'google', number>>;
  months: string[];
  meta: number; // monthly meta spend baseline, used to derive month data
  google: number; // monthly google spend baseline
  // Static public asset path for this client's own logo, shown in the
  // client profile header (never in the left agency sidebar, that is
  // always Stopply's own mark). Null falls back to no logo shown.
  logoUrl: string | null;
}

const DEMO_CLIENTS: DemoClient[] = [
  {
    id: 'be-clinical',
    slug: 'be-clinical',
    name: 'Be Clinical',
    plan: 'pro',
    timezone: 'America/Los_Angeles',
    platforms: ['meta', 'google'],
    monthlyBudget: 28500,
    platformBudgets: { meta: 19000, google: 9500 },
    months: ['2026-05', '2026-06'],
    meta: 7100,
    google: 4200,
    logoUrl: '/demo-logos/be-clinical.svg',
  },
  {
    id: 'back-9-golf',
    slug: 'back-9-golf',
    name: 'Back 9 Golf',
    plan: 'starter',
    timezone: 'America/Phoenix',
    platforms: ['meta', 'google'],
    monthlyBudget: 6000,
    platformBudgets: { meta: 3500, google: 2500 },
    months: ['2026-06'],
    meta: 3500,
    google: 2500,
    logoUrl: null,
  },
  {
    id: 'deep-clean-cleaners',
    slug: 'deep-clean-cleaners',
    name: 'Deep Clean Cleaners',
    plan: 'whitelabel',
    timezone: 'America/Phoenix',
    platforms: ['meta', 'google'],
    monthlyBudget: 4500,
    platformBudgets: { meta: 1500, google: 3000 },
    months: ['2026-06'],
    meta: 1500,
    google: 3000,
    logoUrl: null,
  },
];

const DEFAULT_CLIENT = DEMO_CLIENTS[0];

// Mutable, like csrfToken in api.ts: updated when the demo "Clients" tab
// switches the active client. Read by demoApi.ts for every subsequent
// tenant-scoped request.
let activeClientId = DEFAULT_CLIENT.id;

export function setActiveDemoClient(id: string): DemoClient | null {
  const client = DEMO_CLIENTS.find((c) => c.id === id);
  if (!client) return null;
  activeClientId = client.id;
  return client;
}

export function getActiveDemoClient(): DemoClient {
  return DEMO_CLIENTS.find((c) => c.id === activeClientId) ?? DEFAULT_CLIENT;
}

export function getActiveDemoClientLogoUrl(): string | null {
  return getActiveDemoClient().logoUrl;
}

export const DEMO_ME: Me = {
  userType: 'agency',
  userId: 'demo-agency-user',
  role: 'agency_admin',
  tenantId: null,
  csrf: 'demo-csrf-token',
};

export function getDemoProfile() {
  const client = getActiveDemoClient();
  return {
    id: 'demo-agency-user',
    email: 'agency@demoagency.example',
    name: 'Demo Agency Admin',
    role: 'agency_admin',
    _forClient: client.name,
  };
}

export function getDemoSettings(): TenantSettings {
  const client = getActiveDemoClient();
  return {
    tenant: {
      id: client.id,
      slug: client.slug,
      name: client.name,
      timezone: client.timezone,
      plan: client.plan,
      theme: null,
      layout: null,
      funnelLabels: { lead: 'Leads', scheduled: 'Scheduled', completed: 'Completed', purchase: 'Purchases' },
      footerCredit: true,
      customHostname: null,
      hostnameStatus: null,
    },
    role: 'agency_admin',
    viewConfig: null,
  };
}

export function getDemoSources(): SourceInfo[] {
  const client = getActiveDemoClient();
  const sources: SourceInfo[] = [
    {
      key: 'ghl-contacts',
      name: 'Go High Level (contacts)',
      kind: 'webhook',
      connector_type: 'ghl-contacts',
      cadence: 1,
      platform_link: null,
      how_to: null,
      verified_by: 'demo',
      verified_at: '2026-06-30T12:00:00Z',
      records_through: '2026-06-30',
      last_import_at: '2026-06-30T12:00:00Z',
      freshness: 'green',
    },
  ];
  if (client.platforms.includes('meta')) {
    sources.push({
      key: 'meta-campaign',
      name: 'Meta Ads (campaigns)',
      kind: 'csv',
      connector_type: 'meta-campaign',
      cadence: 7,
      platform_link: null,
      how_to: null,
      verified_by: 'demo',
      verified_at: '2026-06-29T09:00:00Z',
      records_through: '2026-06-28',
      last_import_at: '2026-06-29T09:00:00Z',
      freshness: 'green',
    });
  }
  if (client.platforms.includes('google')) {
    sources.push({
      key: 'google-campaign',
      name: 'Google Ads (campaigns)',
      kind: 'csv',
      connector_type: 'google-campaign',
      cadence: 7,
      platform_link: null,
      how_to: null,
      verified_by: 'demo',
      verified_at: '2026-06-29T09:00:00Z',
      records_through: '2026-06-28',
      last_import_at: '2026-06-29T09:00:00Z',
      freshness: 'green',
    });
  }
  return sources;
}

function monthData(month: string, meta: number, google: number, scale: number): MonthData {
  const leadsMeta = meta > 0 ? Math.round(47 * scale) : 0;
  const leadsGoogle = google > 0 ? Math.round(33 * scale) : 0;
  const channels = [];
  const campaigns = [];
  const adLineItems = [];
  if (meta > 0) {
    channels.push({
      period_month: month,
      channel: 'meta',
      attribution_basis: 'first' as const,
      leads: leadsMeta,
      scheduled: Math.round(leadsMeta * 0.58),
      completed: Math.round(leadsMeta * 0.4),
      purchases: Math.round(leadsMeta * 0.3),
      revenue: Math.round(meta * 2.5),
      spend: meta,
    });
    campaigns.push(
      { period_month: month, channel: 'meta', campaign: 'Meta - Spring Promo', campaign_type: 'Lead Generation', spend: Math.round(meta * 0.55), leads: Math.round(leadsMeta * 0.5), completed: Math.round(leadsMeta * 0.2), revenue: Math.round(meta * 1.3) },
      { period_month: month, channel: 'meta', campaign: 'Meta - Retargeting', campaign_type: 'Retargeting', spend: Math.round(meta * 0.45), leads: Math.round(leadsMeta * 0.5), completed: Math.round(leadsMeta * 0.2), revenue: Math.round(meta * 1.2) }
    );
    adLineItems.push(
      { period_month: month, channel: 'meta', campaign: 'Meta - Spring Promo', ad_name: 'Before/After Carousel', ad_id: 'demo-ad-1', creative_type: 'carousel', creative_type_source: 'auto' as const, spend: Math.round(meta * 0.3), leads_reported: Math.round(leadsMeta * 0.28), cost_per_lead: Math.round((meta * 0.3) / Math.max(1, leadsMeta * 0.28)), completed: null, purchases: null, status: 'top' as const },
      { period_month: month, channel: 'meta', campaign: 'Meta - Retargeting', ad_name: 'Testimonial Video', ad_id: 'demo-ad-2', creative_type: 'video', creative_type_source: 'auto' as const, spend: Math.round(meta * 0.25), leads_reported: Math.round(leadsMeta * 0.22), cost_per_lead: Math.round((meta * 0.25) / Math.max(1, leadsMeta * 0.22)), completed: null, purchases: null, status: 'watch' as const }
    );
  }
  if (google > 0) {
    channels.push({
      period_month: month,
      channel: 'google',
      attribution_basis: 'first' as const,
      leads: leadsGoogle,
      scheduled: Math.round(leadsGoogle * 0.6),
      completed: Math.round(leadsGoogle * 0.48),
      purchases: Math.round(leadsGoogle * 0.36),
      revenue: Math.round(google * 3.9),
      spend: google,
    });
    campaigns.push(
      { period_month: month, channel: 'google', campaign: 'Google - Search Brand', campaign_type: 'Search', spend: Math.round(google * 0.4), leads: Math.round(leadsGoogle * 0.45), completed: Math.round(leadsGoogle * 0.22), revenue: Math.round(google * 1.6) },
      { period_month: month, channel: 'google', campaign: 'Google - Near Me', campaign_type: null, spend: Math.round(google * 0.6), leads: Math.round(leadsGoogle * 0.55), completed: Math.round(leadsGoogle * 0.26), revenue: Math.round(google * 2.3) }
    );
    adLineItems.push({
      period_month: month, channel: 'google', campaign: 'Google - Near Me', ad_name: 'Near Me - RSA', ad_id: 'demo-ad-3', creative_type: 'text', creative_type_source: 'auto' as const, spend: Math.round(google * 0.5), leads_reported: Math.round(leadsGoogle * 0.5), cost_per_lead: Math.round((google * 0.5) / Math.max(1, leadsGoogle * 0.5)), completed: null, purchases: null, status: 'top' as const,
    });
  }
  return {
    month,
    basis: 'first',
    channels,
    campaigns,
    adLineItems,
    cohort: [],
    quality: null,
    targets: [
      { period_month: month, metric: 'leads', value: Math.round((leadsMeta + leadsGoogle) * 1.15) || 20 },
      { period_month: month, metric: 'revenue', value: Math.round((meta * 2.5 + google * 3.9) * 1.1) || 5000 },
    ],
  };
}

// Per-campaign / per-creative breakdown for each client's June 2026
// month. Be Clinical's is modeled on a real Meta ad-set export for
// structure only (ad set names, which campaign they belong to, roughly
// which are active vs paused); Back 9 Golf and Deep Clean Cleaners are
// fully fabricated but industry-plausible. Every spend/lead/show/booking
// number below is fabricated, not any client's actual figures.
export interface CampaignRow {
  campaign: string;
  campaignType: string;
  ad: string;
  creativeType: string | null;
  spend: number;
  leads: number;
  shows: number;
  bookings: number;
}

const BE_CLINICAL_JUNE_META: CampaignRow[] = [
  { campaign: 'BBL', campaignType: 'Lead Generation', ad: 'BBL Reels - Daily', creativeType: 'Video', spend: 6200, leads: 54, shows: 33, bookings: 19 },
  { campaign: 'BBL', campaignType: 'Lead Generation', ad: 'BBL Image Ads', creativeType: 'Static', spend: 8150, leads: 62, shows: 37, bookings: 21 },
  { campaign: 'BBL', campaignType: 'Lead Generation', ad: 'BBL Buy 3 Get the 4th Free', creativeType: 'Static', spend: 1240, leads: 11, shows: 6, bookings: 3 },
  { campaign: 'PDO Threads', campaignType: 'Lead Generation', ad: 'PDO Thread 4x5 - v1', creativeType: 'Video', spend: 410, leads: 24, shows: 15, bookings: 9 },
  { campaign: 'PDO Threads', campaignType: 'Lead Generation', ad: 'PDO Thread 9x16 - v1', creativeType: 'Video', spend: 395, leads: 19, shows: 12, bookings: 7 },
  { campaign: 'PDO Threads', campaignType: 'Lead Generation', ad: '$250 Off PDO Threads Image Ad', creativeType: 'Static', spend: 890, leads: 21, shows: 13, bookings: 8 },
  { campaign: 'Radiesse', campaignType: 'Lead Generation', ad: 'Radiesse - Daily Budget', creativeType: 'Video', spend: 640, leads: 9, shows: 5, bookings: 3 },
  { campaign: 'Radiesse', campaignType: 'Lead Generation', ad: 'Radiesse Pic Ad Sets', creativeType: 'Static', spend: 310, leads: 4, shows: 2, bookings: 1 },
  { campaign: 'Rejuran', campaignType: 'Lead Generation', ad: 'Rejuran Reel - Daily Budget', creativeType: 'Video', spend: 520, leads: 7, shows: 4, bookings: 2 },
  { campaign: 'Rejuran', campaignType: 'Lead Generation', ad: 'Rejuran Reel - Schedule - v2', creativeType: 'Video', spend: 180, leads: 3, shows: 2, bookings: 1 },
  { campaign: 'Botox / Wrinkle Relaxers', campaignType: 'Lead Generation', ad: 'Botox Reel - Daily Budget', creativeType: 'Video', spend: 2980, leads: 41, shows: 24, bookings: 14 },
  { campaign: 'Botox / Wrinkle Relaxers', campaignType: 'Lead Generation', ad: 'Wrinkle Relaxers Image Ad Set', creativeType: 'Static', spend: 1180, leads: 17, shows: 10, bookings: 6 },
  { campaign: 'General Skin', campaignType: 'Lead Generation', ad: 'General Skin Improvement 4x5 - v3', creativeType: 'Video', spend: 420, leads: 16, shows: 10, bookings: 6 },
  { campaign: 'General Skin', campaignType: 'Lead Generation', ad: 'Microneedling Image Ad Set', creativeType: 'Static', spend: 980, leads: 14, shows: 8, bookings: 5 },
  { campaign: 'Halo', campaignType: 'Lead Generation', ad: '$250 Off Halo Image Ad Set', creativeType: 'Static', spend: 460, leads: 12, shows: 7, bookings: 4 },
  { campaign: 'Sculptra', campaignType: 'Lead Generation', ad: '20% Off Sculptra Ad Set', creativeType: 'Static', spend: 410, leads: 6, shows: 3, bookings: 2 },
];

const BE_CLINICAL_JUNE_GOOGLE: CampaignRow[] = [
  { campaign: 'HALO', campaignType: 'Search', ad: 'HALO Landing Page', creativeType: null, spend: 2350, leads: 19, shows: 13, bookings: 8 },
  { campaign: 'RF Microneedling (Potenza)', campaignType: 'Search', ad: 'RF Landing Page', creativeType: null, spend: 700, leads: 5, shows: 3, bookings: 2 },
  { campaign: 'Hair Restoration PRP', campaignType: 'Search', ad: 'PRP Landing Page', creativeType: null, spend: 2300, leads: 16, shows: 11, bookings: 6 },
  { campaign: 'Korean Mesotherapy / Rejuran', campaignType: 'Search', ad: 'KM Landing Page', creativeType: null, spend: 680, leads: 6, shows: 4, bookings: 2 },
  { campaign: 'PDO', campaignType: 'Search', ad: 'PDO Landing Page', creativeType: null, spend: 1400, leads: 11, shows: 7, bookings: 4 },
  { campaign: 'BBL', campaignType: 'Search', ad: 'BBL Landing Page', creativeType: null, spend: 1380, leads: 10, shows: 6, bookings: 4 },
];

const BACK_9_GOLF_JUNE_META: CampaignRow[] = [
  { campaign: 'Membership Drive', campaignType: 'Lead Generation', ad: 'Founding Member Promo Video', creativeType: 'Video', spend: 900, leads: 14, shows: 9, bookings: 5 },
  { campaign: 'Membership Drive', campaignType: 'Lead Generation', ad: 'Membership Carousel', creativeType: 'Carousel', spend: 650, leads: 10, shows: 6, bookings: 3 },
  { campaign: 'Golf Simulator Bays', campaignType: 'Lead Generation', ad: 'Simulator Bay Reel', creativeType: 'Video', spend: 780, leads: 16, shows: 11, bookings: 7 },
  { campaign: 'Junior Golf Camp', campaignType: 'Lead Generation', ad: 'Summer Camp Flyer Image', creativeType: 'Static', spend: 520, leads: 12, shows: 8, bookings: 5 },
  { campaign: 'Corporate & Group Events', campaignType: 'Lead Generation', ad: 'Corporate Outing Image', creativeType: 'Static', spend: 650, leads: 8, shows: 5, bookings: 3 },
];

const BACK_9_GOLF_JUNE_GOOGLE: CampaignRow[] = [
  { campaign: 'Tee Times', campaignType: 'Search', ad: 'Tee Times Landing Page', creativeType: null, spend: 1200, leads: 22, shows: 15, bookings: 9 },
  { campaign: 'Golf Lessons', campaignType: 'Search', ad: 'Lessons Landing Page', creativeType: null, spend: 900, leads: 11, shows: 7, bookings: 4 },
  { campaign: 'Pro Shop', campaignType: 'Search', ad: 'Pro Shop Landing Page', creativeType: null, spend: 400, leads: 6, shows: 4, bookings: 2 },
];

const DEEP_CLEAN_JUNE_META: CampaignRow[] = [
  { campaign: 'Move-In / Move-Out Special', campaignType: 'Lead Generation', ad: 'Move Out Special Image', creativeType: 'Static', spend: 620, leads: 15, shows: 10, bookings: 6 },
  { campaign: 'Recurring Maid Service', campaignType: 'Lead Generation', ad: 'Weekly Cleaning Reel', creativeType: 'Video', spend: 880, leads: 19, shows: 13, bookings: 8 },
];

const DEEP_CLEAN_JUNE_GOOGLE: CampaignRow[] = [
  { campaign: 'House Cleaning', campaignType: 'Search', ad: 'House Cleaning Landing Page', creativeType: null, spend: 1400, leads: 26, shows: 18, bookings: 11 },
  { campaign: 'Office Cleaning', campaignType: 'Search', ad: 'Office Cleaning Landing Page', creativeType: null, spend: 900, leads: 13, shows: 9, bookings: 5 },
  { campaign: 'Deep Clean / Post-Construction', campaignType: 'Search', ad: 'Deep Clean Landing Page', creativeType: null, spend: 700, leads: 9, shows: 6, bookings: 3 },
];

function statusForCostPerLead(costPerLead: number): 'top' | 'watch' | 'under' {
  if (costPerLead < 70) return 'top';
  if (costPerLead <= 120) return 'watch';
  return 'under';
}

function buildCampaignChannel(
  channel: 'meta' | 'google',
  rows: CampaignRow[],
  roas: number,
  month: string
): { channelMetrics: ChannelMetrics; campaigns: CampaignMetrics[]; adLineItems: AdLineItem[] } {
  const byCampaign = new Map<string, CampaignRow[]>();
  for (const r of rows) {
    const list = byCampaign.get(r.campaign) ?? [];
    list.push(r);
    byCampaign.set(r.campaign, list);
  }

  const campaigns: CampaignMetrics[] = [...byCampaign.entries()].map(([campaign, rs]) => {
    const spend = rs.reduce((a, r) => a + r.spend, 0);
    const leads = rs.reduce((a, r) => a + r.leads, 0);
    const completed = rs.reduce((a, r) => a + r.shows, 0);
    return {
      period_month: month,
      channel,
      campaign,
      campaign_type: rs[0]!.campaignType,
      spend,
      leads,
      completed,
      revenue: Math.round(spend * roas),
    };
  });

  const adLineItems: AdLineItem[] = rows.map((r, i) => {
    // Some real ad sets spend money with zero attributed leads that
    // month (e.g. small testing budgets, or leads not yet synced) -
    // guard against dividing by zero rather than assuming leads > 0.
    const costPerLead = r.leads > 0 ? r.spend / r.leads : null;
    return {
      period_month: month,
      channel,
      campaign: r.campaign,
      ad_name: r.ad,
      ad_id: `demo-${month}-${channel}-${i + 1}`,
      creative_type: r.creativeType,
      creative_type_source: 'auto',
      spend: r.spend,
      leads_reported: r.leads,
      cost_per_lead: costPerLead !== null ? Math.round(costPerLead * 100) / 100 : null,
      completed: r.shows,
      purchases: r.bookings,
      status: costPerLead !== null ? statusForCostPerLead(costPerLead) : null,
    };
  });

  const leads = rows.reduce((a, r) => a + r.leads, 0);
  const completed = rows.reduce((a, r) => a + r.shows, 0);
  const purchases = rows.reduce((a, r) => a + r.bookings, 0);
  const spend = rows.reduce((a, r) => a + r.spend, 0);

  const channelMetrics: ChannelMetrics = {
    period_month: month,
    channel,
    attribution_basis: 'first',
    leads,
    scheduled: Math.round(completed / 0.82),
    completed,
    purchases,
    revenue: Math.round(spend * roas),
    spend,
  };

  return { channelMetrics, campaigns, adLineItems };
}

function buildHandAuthoredMonthData(month: string, metaRows: CampaignRow[], googleRows: CampaignRow[]): MonthData {
  const meta = buildCampaignChannel('meta', metaRows, 2.5, month);
  const google = buildCampaignChannel('google', googleRows, 3.9, month);
  const totalLeads = meta.channelMetrics.leads + google.channelMetrics.leads;
  const totalRevenue = meta.channelMetrics.revenue + google.channelMetrics.revenue;

  return {
    month,
    basis: 'first',
    channels: [meta.channelMetrics, google.channelMetrics],
    campaigns: [...meta.campaigns, ...google.campaigns],
    adLineItems: [...meta.adLineItems, ...google.adLineItems],
    cohort: [],
    quality: null,
    targets: [
      { period_month: month, metric: 'leads', value: Math.round(totalLeads * 1.15) },
      { period_month: month, metric: 'revenue', value: Math.round(totalRevenue * 1.1) },
    ],
  };
}

// Be Clinical's May 2026 Meta rows are real (spend, leads/"Results", which
// ad sets were active), taken directly from a real Meta ad-set export -
// not a fabricated structural template like the June data below. Meta's
// export has no visibility into what happens after the lead (no
// show/booking data lives in an ad platform, only in the CRM's lead-to-
// appointment matching), so `shows`/`bookings` here are still estimated
// at a flat 60% show rate / 55% show-to-booking rate. Rows with zero
// spend and zero activity in the real export (fully dormant ad sets)
// are omitted. Google side has no real export yet, so it's a fabricated
// estimate (roughly 85% of June's Google numbers).
const BE_CLINICAL_MAY_META: CampaignRow[] = [
  { campaign: 'BBL', campaignType: 'Lead Generation', ad: 'BBL Reels - Daily', creativeType: 'Video', spend: 6419, leads: 66, shows: 40, bookings: 22 },
  { campaign: 'Radiesse', campaignType: 'Lead Generation', ad: 'Radiesse - Daily Budget', creativeType: 'Video', spend: 1579, leads: 10, shows: 6, bookings: 3 },
  { campaign: 'Radiesse', campaignType: 'Lead Generation', ad: 'Radiesse Pic Ad Sets', creativeType: 'Static', spend: 241, leads: 0, shows: 0, bookings: 0 },
  { campaign: 'Rejuran', campaignType: 'Lead Generation', ad: 'Rejuran Reel - Daily Budget', creativeType: 'Video', spend: 2752, leads: 1, shows: 0, bookings: 0 },
  { campaign: 'Rejuran', campaignType: 'Lead Generation', ad: 'Rejuran Reel - Schedule - v2', creativeType: 'Video', spend: 1881, leads: 0, shows: 0, bookings: 0 },
  { campaign: 'Botox / Wrinkle Relaxers', campaignType: 'Lead Generation', ad: 'Botox Reel - Daily Budget', creativeType: 'Video', spend: 3356, leads: 0, shows: 0, bookings: 0 },
];

const BE_CLINICAL_MAY_GOOGLE: CampaignRow[] = [
  { campaign: 'HALO', campaignType: 'Search', ad: 'HALO Landing Page', creativeType: null, spend: 2000, leads: 16, shows: 11, bookings: 7 },
  { campaign: 'RF Microneedling (Potenza)', campaignType: 'Search', ad: 'RF Landing Page', creativeType: null, spend: 600, leads: 4, shows: 3, bookings: 2 },
  { campaign: 'Hair Restoration PRP', campaignType: 'Search', ad: 'PRP Landing Page', creativeType: null, spend: 1950, leads: 14, shows: 9, bookings: 5 },
  { campaign: 'Korean Mesotherapy / Rejuran', campaignType: 'Search', ad: 'KM Landing Page', creativeType: null, spend: 580, leads: 5, shows: 3, bookings: 2 },
  { campaign: 'PDO', campaignType: 'Search', ad: 'PDO Landing Page', creativeType: null, spend: 1190, leads: 9, shows: 6, bookings: 3 },
  { campaign: 'BBL', campaignType: 'Search', ad: 'BBL Landing Page', creativeType: null, spend: 1170, leads: 9, shows: 5, bookings: 3 },
];

// Hand-authored per-client month breakdowns, keyed by month then client
// id then channel. These are the *defaults* - a starting point. The
// user can add/edit/remove campaigns and creatives from the "Manage
// campaigns" editor on the Main Dashboard; those edits are saved to
// localStorage (see getEditableCampaignRows below) and take over from
// the defaults for that specific client/month/channel. Any client/month
// combination not in this map, with no saved edits either, falls back
// to the generic monthData() formula below.
const DEFAULT_CAMPAIGN_ROWS: Record<string, Record<string, { meta: CampaignRow[]; google: CampaignRow[] }>> = {
  '2026-05': {
    'be-clinical': { meta: BE_CLINICAL_MAY_META, google: BE_CLINICAL_MAY_GOOGLE },
  },
  '2026-06': {
    'be-clinical': { meta: BE_CLINICAL_JUNE_META, google: BE_CLINICAL_JUNE_GOOGLE },
    'back-9-golf': { meta: BACK_9_GOLF_JUNE_META, google: BACK_9_GOLF_JUNE_GOOGLE },
    'deep-clean-cleaners': { meta: DEEP_CLEAN_JUNE_META, google: DEEP_CLEAN_JUNE_GOOGLE },
  },
};

// Edits live in localStorage, never touch the codebase, and are scoped
// to this one browser - "practical... but not so much freedom I could
// destroy everything." Keyed per client/month/channel so editing one
// client's June Meta campaigns never affects another client or channel.
function campaignOverrideKey(clientId: string, month: string, channel: 'meta' | 'google'): string {
  return `demo-campaigns:${clientId}:${month}:${channel}`;
}

function readCampaignOverride(clientId: string, month: string, channel: 'meta' | 'google'): CampaignRow[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(campaignOverrideKey(clientId, month, channel));
    return raw ? (JSON.parse(raw) as CampaignRow[]) : null;
  } catch {
    return null;
  }
}

export function hasCampaignOverride(clientId: string, month: string, channel: 'meta' | 'google'): boolean {
  return readCampaignOverride(clientId, month, channel) !== null;
}

// The rows actually in effect right now: saved edits if any exist, else
// the hand-authored defaults, else an empty list (a blank slate the
// editor can build up from scratch via "Add campaign").
export function getEditableCampaignRows(clientId: string, month: string, channel: 'meta' | 'google'): CampaignRow[] {
  const override = readCampaignOverride(clientId, month, channel);
  if (override) return override;
  return DEFAULT_CAMPAIGN_ROWS[month]?.[clientId]?.[channel] ?? [];
}

export function saveEditableCampaignRows(
  clientId: string,
  month: string,
  channel: 'meta' | 'google',
  rows: CampaignRow[]
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(campaignOverrideKey(clientId, month, channel), JSON.stringify(rows));
  } catch {
    /* ignore, e.g. storage disabled or full */
  }
}

export function resetEditableCampaignRows(clientId: string, month: string, channel: 'meta' | 'google'): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(campaignOverrideKey(clientId, month, channel));
}

function getMonthDataForClient(client: DemoClient, month: string): MonthData {
  const hasDefaults = !!DEFAULT_CAMPAIGN_ROWS[month]?.[client.id];
  const hasEdits = hasCampaignOverride(client.id, month, 'meta') || hasCampaignOverride(client.id, month, 'google');
  if (hasDefaults || hasEdits) {
    const metaRows = getEditableCampaignRows(client.id, month, 'meta');
    const googleRows = getEditableCampaignRows(client.id, month, 'google');
    return buildHandAuthoredMonthData(month, metaRows, googleRows);
  }
  const scale = month === client.months[client.months.length - 1] ? 1 : 0.85;
  return monthData(month, client.meta, client.google, scale);
}

export function getDemoMonthData(month: string): MonthData {
  return getMonthDataForClient(getActiveDemoClient(), month);
}

export function getDemoMonthsResponse() {
  return { months: getActiveDemoClient().months };
}

export function getDemoTeamUsers() {
  const client = getActiveDemoClient();
  return [
    { id: 'demo-user', email: `owner@${client.slug}.example`, name: `${client.name} Admin`, role: 'account_admin' as const, view_config_json: null, active: 1 },
    { id: 'demo-viewer', email: `viewer@${client.slug}.example`, name: 'Front Desk Viewer', role: 'viewer' as const, view_config_json: null, active: 1 },
  ];
}

// Agency team roster for GET /api/agency/users, the agency-level Team
// section (distinct from getDemoTeamUsers, which is the per-tenant roster).
export function getDemoAgencyUsers() {
  return [
    {
      id: 'demo-agency-user',
      email: 'agency@demoagency.example',
      name: 'Demo Agency Admin',
      role: 'agency_admin' as const,
      assigned_tenants_json: null,
      permissions_json: JSON.stringify({ manageSecrets: true }),
      active: 1,
      created_at: '2026-01-15T09:00:00Z',
    },
    {
      id: 'demo-agency-staff',
      email: 'staff@demoagency.example',
      name: 'Demo Agency Staff',
      role: 'agency_staff' as const,
      assigned_tenants_json: JSON.stringify([DEMO_CLIENTS[0].id, DEMO_CLIENTS[1].id]),
      permissions_json: JSON.stringify({ manageSecrets: false }),
      active: 1,
      created_at: '2026-03-02T09:00:00Z',
    },
  ];
}

// Roster row shape for GET /api/agency/overview, the "Clients" tab.
export function getDemoAgencyOverview() {
  const month = DEFAULT_CLIENT.months[DEFAULT_CLIENT.months.length - 1];
  const tenants = DEMO_CLIENTS.map((client) => {
    const data = getMonthDataForClient(client, client.months[client.months.length - 1]);
    const leads = data.channels.reduce((sum, c) => sum + c.leads, 0);
    const scheduled = data.channels.reduce((sum, c) => sum + c.scheduled, 0);
    const completed = data.channels.reduce((sum, c) => sum + c.completed, 0);
    const purchases = data.channels.reduce((sum, c) => sum + c.purchases, 0);
    const revenue = data.channels.reduce((sum, c) => sum + c.revenue, 0);
    const spend = data.channels.reduce((sum, c) => sum + c.spend, 0);
    return {
      id: client.id,
      slug: client.slug,
      name: client.name,
      plan: client.plan,
      leads,
      scheduled,
      completed,
      purchases,
      revenue,
      spend,
      pulled_at: '2026-06-30T12:00:00Z',
      monthly_ad_spend_budget: client.monthlyBudget,
      ad_platforms_json: JSON.stringify(client.platforms),
      ad_platform_budget_json: JSON.stringify(client.platformBudgets),
    };
  });
  return { month, tenants };
}
