// Sums a list of single-month MonthData payloads into one aggregate for
// the master date range. Numeric fields sum; qualitative per-ad fields
// (creative_type, status, period_month) come from the newest month an ad
// appears in, so editing a tag in a merged range always targets that
// newest occurrence and shows up immediately.

import type { AdLineItem, CampaignMetrics, ChannelMetrics, CohortRow, MonthData, MonthQuality, RepMetricsRow } from './types';

function mergeChannels(rows: ChannelMetrics[]): ChannelMetrics[] {
  const map = new Map<string, ChannelMetrics>();
  for (const r of rows) {
    const cur = map.get(r.channel);
    if (cur) {
      cur.leads += r.leads;
      cur.scheduled += r.scheduled;
      cur.completed += r.completed;
      cur.purchases += r.purchases;
      cur.revenue += r.revenue;
      cur.spend += r.spend;
    } else {
      map.set(r.channel, { ...r });
    }
  }
  return [...map.values()];
}

function mergeCampaigns(rows: CampaignMetrics[]): CampaignMetrics[] {
  const map = new Map<string, CampaignMetrics>();
  for (const r of rows) {
    const key = `${r.channel}|${r.campaign}`;
    const cur = map.get(key);
    if (cur) {
      cur.spend += r.spend;
      cur.leads += r.leads;
      cur.completed += r.completed;
      cur.revenue += r.revenue;
      if (!cur.campaign_type && r.campaign_type) cur.campaign_type = r.campaign_type;
    } else {
      map.set(key, { ...r });
    }
  }
  return [...map.values()];
}

// `byMonthDesc` must be ordered newest month first: the first time a key
// is seen seeds creative_type/status/ad_id/period_month, later (older)
// occurrences only add to the numeric totals.
function mergeAdLineItems(byMonthDesc: AdLineItem[][]): AdLineItem[] {
  const map = new Map<string, AdLineItem>();
  for (const monthRows of byMonthDesc) {
    for (const r of monthRows) {
      const key = `${r.channel}|${r.campaign}|${r.ad_name}`;
      const cur = map.get(key);
      if (cur) {
        cur.spend += r.spend;
        cur.leads_reported = (cur.leads_reported ?? 0) + (r.leads_reported ?? 0);
        cur.completed = (cur.completed ?? 0) + (r.completed ?? 0);
        cur.purchases = (cur.purchases ?? 0) + (r.purchases ?? 0);
      } else {
        map.set(key, { ...r });
      }
    }
  }
  for (const row of map.values()) {
    row.cost_per_lead = row.leads_reported && row.leads_reported > 0 ? row.spend / row.leads_reported : null;
  }
  return [...map.values()];
}

function mergeCohort(rows: CohortRow[]): CohortRow[] {
  const map = new Map<string, CohortRow>();
  for (const r of rows) {
    const key = `${r.channel}|${r.bucket}`;
    const cur = map.get(key);
    if (cur) {
      cur.completed += r.completed;
      cur.revenue += r.revenue;
    } else {
      map.set(key, { ...r });
    }
  }
  return [...map.values()];
}

function mergeReps(rows: RepMetricsRow[]): RepMetricsRow[] {
  const map = new Map<string, RepMetricsRow>();
  for (const r of rows) {
    const cur = map.get(r.rep);
    if (cur) {
      cur.knocks += r.knocks;
      cur.pitches += r.pitches;
      cur.appointments_set += r.appointments_set;
      cur.sits_set += r.sits_set;
      cur.sits_run += r.sits_run;
      cur.closes += r.closes;
      cur.installs += r.installs;
    } else {
      map.set(r.rep, { ...r });
    }
  }
  return [...map.values()];
}

function mergeQuality(rows: MonthQuality[]): MonthQuality | null {
  if (rows.length === 0) return null;
  return rows.reduce((acc, r) => ({
    period_month: acc.period_month,
    ambiguous_match_count: acc.ambiguous_match_count + r.ambiguous_match_count,
    unmatched_lead_count: acc.unmatched_lead_count + r.unmatched_lead_count,
    partial_only_count: acc.partial_only_count + r.partial_only_count,
  }));
}

function mergeTargets(rows: MonthData['targets']): MonthData['targets'] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.metric, (map.get(r.metric) ?? 0) + r.value);
  return [...map.entries()].map(([metric, value]) => ({ period_month: '', metric, value }));
}

export function mergeMonthData(list: MonthData[]): MonthData | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0]!;

  const byMonthDesc = [...list].sort((a, b) => (a.month < b.month ? 1 : -1));

  return {
    month: byMonthDesc[0]!.month,
    basis: byMonthDesc[0]!.basis,
    channels: mergeChannels(list.flatMap((d) => d.channels)),
    campaigns: mergeCampaigns(list.flatMap((d) => d.campaigns)),
    adLineItems: mergeAdLineItems(byMonthDesc.map((d) => d.adLineItems)),
    cohort: mergeCohort(list.flatMap((d) => d.cohort)),
    quality: mergeQuality(list.map((d) => d.quality).filter((q): q is MonthQuality => !!q)),
    targets: mergeTargets(list.flatMap((d) => d.targets)),
    reps: mergeReps(list.flatMap((d) => d.reps ?? [])),
  };
}
