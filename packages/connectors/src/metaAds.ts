// Live Meta Marketing API pull for ad spend, as an alternative to the
// manual "Meta Ads" CSV export/upload path (see parsers.ts's
// parseMetaCampaign / parseMetaAdLineItem). Produces the exact same
// AdSpendRow/AdLineItemRow shape those parsers do, so the result goes
// through the same applyParseResult ingestion + rollup pipeline a CSV
// upload already uses - no new database-writing logic needed here.
//
// Auth: a long-lived Meta Business "System User" access token (Business
// Settings -> System Users), scoped to just the ad accounts this
// agency manages. That is Meta's "Standard Access" tier and does not
// require App Review / Advanced Access - the ad accounts pulled here
// are ones the token's own Business Manager already administers
// directly, not an independent third party's account connecting on
// its own.

import type { AdSpendRow, AdLineItemRow, ParseResult } from './parsers';

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Meta reports "results" under different action_type strings depending
// on how the advertiser's lead event is configured. These are the ones
// that mean "a lead came in," checked in the order they show up most
// often on lead-gen campaigns.
const LEAD_ACTION_TYPES = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_web_lead',
];

interface MetaAction {
  action_type: string;
  value: string;
}

interface MetaInsightRow {
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  actions?: MetaAction[];
}

interface MetaInsightsResponse {
  data?: MetaInsightRow[];
  paging?: { next?: string };
  error?: { message: string; type: string; code: number };
}

function leadsFrom(actions: MetaAction[] | undefined): number | null {
  if (!actions) return null;
  const total = actions
    .filter((a) => LEAD_ACTION_TYPES.includes(a.action_type))
    .reduce((sum, a) => sum + (Number(a.value) || 0), 0);
  return total > 0 ? total : null;
}

// "2026-06" -> { since: "2026-06-01", until: "2026-06-30" }.
function monthRange(periodMonth: string): { since: string; until: string } {
  const [year, month] = periodMonth.split('-').map(Number);
  const since = `${periodMonth}-01`;
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const until = `${periodMonth}-${String(lastDay).padStart(2, '0')}`;
  return { since, until };
}

async function fetchAllPages(url: string, fetchImpl: typeof fetch): Promise<MetaInsightRow[]> {
  const rows: MetaInsightRow[] = [];
  let next: string | undefined = url;
  // Insights are paginated; a single ad account rarely needs more than
  // a page or two of campaigns/ads for one month, but don't silently
  // truncate if an account has a lot of activity.
  while (next) {
    const res = await fetchImpl(next);
    const json = (await res.json()) as MetaInsightsResponse;
    if (json.error) {
      throw new Error(`Meta API error (${json.error.code}): ${json.error.message}`);
    }
    rows.push(...(json.data ?? []));
    next = json.paging?.next;
  }
  return rows;
}

// Campaign-level spend and leads, matching parseMetaCampaign's output.
export async function fetchMetaCampaignSpend(
  accessToken: string,
  adAccountId: string,
  periodMonth: string,
  fetchImpl: typeof fetch = fetch
): Promise<ParseResult> {
  const { since, until } = monthRange(periodMonth);
  const fields = ['campaign_name', 'spend', 'actions'].join(',');
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const url = `${GRAPH_BASE}/act_${adAccountId}/insights?level=campaign&time_range=${timeRange}&fields=${fields}&limit=500&access_token=${accessToken}`;

  const rows = await fetchAllPages(url, fetchImpl);
  const adSpend: AdSpendRow[] = rows
    .filter((r) => r.campaign_name)
    .map((r) => ({
      periodMonth,
      channel: 'Meta',
      campaign: r.campaign_name!,
      spend: Number(r.spend) || 0,
      leadsReported: leadsFrom(r.actions),
    }));

  return { kind: 'ad-spend', adSpend, rowCount: adSpend.length, recordsFrom: since, recordsThrough: until };
}

// Ad-level spend and leads, matching parseMetaAdLineItem's output.
// Meta's insights API has no creative-type field the way a manual
// export sometimes does (video/carousel/static) - that distinction was
// already dropped from the dashboard as noise, so it's left null here
// too rather than guessed at.
export async function fetchMetaAdLineItems(
  accessToken: string,
  adAccountId: string,
  periodMonth: string,
  fetchImpl: typeof fetch = fetch
): Promise<ParseResult> {
  const { since, until } = monthRange(periodMonth);
  const fields = ['campaign_name', 'ad_id', 'ad_name', 'spend', 'actions'].join(',');
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const url = `${GRAPH_BASE}/act_${adAccountId}/insights?level=ad&time_range=${timeRange}&fields=${fields}&limit=500&access_token=${accessToken}`;

  const rows = await fetchAllPages(url, fetchImpl);
  const adLineItems: AdLineItemRow[] = rows
    .filter((r) => r.campaign_name && r.ad_name)
    .map((r) => ({
      periodMonth,
      channel: 'Meta',
      campaign: r.campaign_name!,
      adName: r.ad_name!,
      adId: r.ad_id ?? null,
      creativeType: null,
      spend: Number(r.spend) || 0,
      leadsReported: leadsFrom(r.actions),
    }));

  return { kind: 'ad-line-items', adLineItems, rowCount: adLineItems.length, recordsFrom: since, recordsThrough: until };
}

// A lightweight connection check: confirm the token can see this ad
// account at all, before wiring it into a real tenant's source.
export async function testMetaConnection(
  accessToken: string,
  adAccountId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; accountName?: string; message?: string }> {
  const url = `${GRAPH_BASE}/act_${adAccountId}?fields=name,account_status&access_token=${accessToken}`;
  try {
    const res = await fetchImpl(url);
    const json = (await res.json()) as { name?: string; account_status?: number; error?: { message: string } };
    if (json.error) return { ok: false, message: json.error.message };
    return { ok: true, accountName: json.name };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'network error' };
  }
}
