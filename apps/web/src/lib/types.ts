export interface FunnelLabels {
  lead: string;
  scheduled: string;
  completed: string;
  purchase: string;
}

export const DEFAULT_LABELS: FunnelLabels = {
  lead: 'Leads',
  scheduled: 'Scheduled',
  completed: 'Completed',
  purchase: 'Purchases',
};

export interface TenantSettings {
  tenant: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    plan: 'starter' | 'pro' | 'whitelabel';
    theme: Record<string, string> | null;
    layout: { cards: Array<{ id: string; type: string; visible: boolean; label?: string }> } | null;
    funnelLabels: FunnelLabels | null;
    footerCredit: boolean;
    customHostname: string | null;
    hostnameStatus: string | null;
  };
  role: 'agency_admin' | 'agency_staff' | 'account_admin' | 'viewer';
  viewConfig: { tabs: string[]; months: string[] | 'all'; channels: string[] | 'all' } | null;
}

export interface ChannelMetrics {
  period_month: string;
  channel: string;
  attribution_basis: 'first' | 'latest';
  leads: number;
  scheduled: number;
  completed: number;
  purchases: number;
  revenue: number;
  spend: number;
}

export interface CampaignMetrics {
  period_month: string;
  channel: string;
  campaign: string;
  spend: number;
  leads: number;
  completed: number;
  revenue: number;
}

export interface CohortRow {
  period_month: string;
  channel: string;
  bucket: '0' | '30' | '60' | '90' | 'total';
  completed: number;
  revenue: number;
}

export interface MonthQuality {
  period_month: string;
  ambiguous_match_count: number;
  unmatched_lead_count: number;
  partial_only_count: number;
}

export interface MonthData {
  month: string;
  basis: 'first' | 'latest';
  channels: ChannelMetrics[];
  campaigns: CampaignMetrics[];
  cohort: CohortRow[];
  quality: MonthQuality | null;
  targets: Array<{ period_month: string; metric: string; value: number }>;
}

export interface SourceInfo {
  key: string;
  name: string;
  kind: 'webhook' | 'pixel' | 'csv' | 'integration';
  connector_type: string | null;
  cadence: number;
  platform_link: string | null;
  how_to: string | null;
  verified_by: string | null;
  verified_at: string | null;
  records_through: string | null;
  last_import_at: string | null;
  freshness: 'gray' | 'green' | 'red';
}

export interface LeadRow {
  contact_id: string;
  created_at: string;
  channel_first: string | null;
  channel_latest: string | null;
  campaign: string | null;
  match_method: string | null;
  match_ambiguous: number;
  first_stage_scheduled_at: string | null;
  first_stage_completed_at: string | null;
  days_to_complete: number | null;
  revenue_in_month: number;
  revenue_90d: number;
}

export type Comparison = 'previous' | 'year' | 'target' | 'none';
