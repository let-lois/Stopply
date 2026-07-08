// Fabricated data for preview demo mode (see demoMode.ts). A fictional
// client, "Demo Med Spa", with plausible but made up Meta/Google numbers.
// Not real client data, not copied from any actual tenant.

import type { Me } from './api';
import type { MonthData, SourceInfo, TenantSettings } from './types';

const DEMO_MONTHS = ['2026-05', '2026-06'];

export const DEMO_ME: Me = {
  userType: 'tenant',
  userId: 'demo-user',
  role: 'account_admin',
  tenantId: 'demo-tenant',
  csrf: 'demo-csrf-token',
};

export const DEMO_PROFILE = {
  id: 'demo-user',
  email: 'owner@demomedspa.example',
  name: 'Demo Med Spa Admin',
  role: 'account_admin',
};

export const DEMO_SETTINGS: TenantSettings = {
  tenant: {
    id: 'demo-tenant',
    slug: 'demo-med-spa',
    name: 'Demo Med Spa',
    timezone: 'America/Phoenix',
    plan: 'pro',
    theme: null,
    layout: null,
    funnelLabels: { lead: 'Leads', scheduled: 'Scheduled', completed: 'Completed', purchase: 'Purchases' },
    footerCredit: true,
    customHostname: null,
    hostnameStatus: null,
  },
  role: 'account_admin',
  viewConfig: null,
};

export const DEMO_SOURCES: SourceInfo[] = [
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
  {
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
  },
  {
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
  },
];

function monthData(month: string, meta: number, google: number, scale: number): MonthData {
  const leadsMeta = Math.round(47 * scale);
  const leadsGoogle = Math.round(33 * scale);
  return {
    month,
    basis: 'first',
    channels: [
      {
        period_month: month,
        channel: 'meta',
        attribution_basis: 'first',
        leads: leadsMeta,
        scheduled: Math.round(leadsMeta * 0.58),
        completed: Math.round(leadsMeta * 0.4),
        purchases: Math.round(leadsMeta * 0.3),
        revenue: Math.round(meta * 2.5),
        spend: meta,
      },
      {
        period_month: month,
        channel: 'google',
        attribution_basis: 'first',
        leads: leadsGoogle,
        scheduled: Math.round(leadsGoogle * 0.6),
        completed: Math.round(leadsGoogle * 0.48),
        purchases: Math.round(leadsGoogle * 0.36),
        revenue: Math.round(google * 3.9),
        spend: google,
      },
    ],
    campaigns: [
      { period_month: month, channel: 'meta', campaign: 'Meta - Spring Promo', spend: Math.round(meta * 0.55), leads: Math.round(leadsMeta * 0.5), completed: Math.round(leadsMeta * 0.2), revenue: Math.round(meta * 1.3) },
      { period_month: month, channel: 'meta', campaign: 'Meta - Botox Retargeting', spend: Math.round(meta * 0.45), leads: Math.round(leadsMeta * 0.5), completed: Math.round(leadsMeta * 0.2), revenue: Math.round(meta * 1.2) },
      { period_month: month, channel: 'google', campaign: 'Google - Search Brand', spend: Math.round(google * 0.4), leads: Math.round(leadsGoogle * 0.45), completed: Math.round(leadsGoogle * 0.22), revenue: Math.round(google * 1.6) },
      { period_month: month, channel: 'google', campaign: 'Google - Med Spa Near Me', spend: Math.round(google * 0.6), leads: Math.round(leadsGoogle * 0.55), completed: Math.round(leadsGoogle * 0.26), revenue: Math.round(google * 2.3) },
    ],
    adLineItems: [
      { period_month: month, channel: 'meta', campaign: 'Meta - Spring Promo', ad_name: 'Before/After Carousel', ad_id: 'demo-ad-1', creative_type: 'carousel', creative_type_source: 'auto', spend: Math.round(meta * 0.3), leads_reported: Math.round(leadsMeta * 0.28), cost_per_lead: Math.round((meta * 0.3) / Math.max(1, leadsMeta * 0.28)), status: 'top' },
      { period_month: month, channel: 'meta', campaign: 'Meta - Botox Retargeting', ad_name: 'Testimonial Video', ad_id: 'demo-ad-2', creative_type: 'video', creative_type_source: 'auto', spend: Math.round(meta * 0.25), leads_reported: Math.round(leadsMeta * 0.22), cost_per_lead: Math.round((meta * 0.25) / Math.max(1, leadsMeta * 0.22)), status: 'watch' },
      { period_month: month, channel: 'google', campaign: 'Google - Med Spa Near Me', ad_name: 'Med Spa Near Me - RSA', ad_id: 'demo-ad-3', creative_type: 'text', creative_type_source: 'auto', spend: Math.round(google * 0.5), leads_reported: Math.round(leadsGoogle * 0.5), cost_per_lead: Math.round((google * 0.5) / Math.max(1, leadsGoogle * 0.5)), status: 'top' },
    ],
    cohort: [],
    quality: null,
    targets: [
      { period_month: month, metric: 'leads', value: 90 },
      { period_month: month, metric: 'revenue', value: 40000 },
    ],
  };
}

const DEMO_MONTH_DATA: Record<string, MonthData> = {
  '2026-05': monthData('2026-05', 6800, 3900, 0.85),
  '2026-06': monthData('2026-06', 7100, 4200, 1),
};

export function getDemoMonthData(month: string): MonthData {
  return DEMO_MONTH_DATA[month] ?? monthData(month, 7000, 4000, 0.9);
}

export const DEMO_MONTHS_RESPONSE = { months: DEMO_MONTHS };

export const DEMO_TEAM_USERS = [
  { id: 'demo-user', email: 'owner@demomedspa.example', name: 'Demo Med Spa Admin', role: 'account_admin' as const, view_config_json: null, active: 1 },
  { id: 'demo-viewer', email: 'viewer@demomedspa.example', name: 'Front Desk Viewer', role: 'viewer' as const, view_config_json: null, active: 1 },
];
