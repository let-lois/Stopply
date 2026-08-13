// Shared types for both planes. The control plane is the bound D1 database.
// Tenant databases are reached over the D1 HTTP API via @letlois/tenant-d1.

export type TenantStatus = 'active' | 'suspended';
export type TenantPlan = 'starter' | 'pro' | 'whitelabel';
export type AgencyRole = 'agency_admin' | 'agency_staff';
export type TenantRole = 'account_admin' | 'viewer';
// Door to door reps who log activity from the field app. Deliberately not
// part of TenantRole: a rep is not a dashboard user, has no row in the
// tenant users table, and no /api/tenant route accepts their session.
export type FieldRole = 'rep' | 'manager';
export type Role = AgencyRole | TenantRole | FieldRole;

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: TenantPlan;
  timezone: string;
  d1_database_id: string | null;
  d1_database_name: string | null;
  schema_version: number;
  theme_json: string | null;
  layout_json: string | null;
  custom_hostname: string | null;
  hostname_status: string | null;
  footer_credit: number;
  funnel_labels_json: string | null;
  monthly_ad_spend_budget: number | null;
  ad_platforms_json: string | null;
  ad_platform_budget_json: string | null;
  created_at: string;
}

export interface AgencyUserRow {
  id: string;
  email: string;
  name: string;
  role: AgencyRole;
  password_hash: string;
  assigned_tenants_json: string | null;
  active: number;
  created_at: string;
}

export interface TenantUserRow {
  id: string;
  email: string;
  name: string;
  role: TenantRole;
  password_hash: string;
  view_config_json: string | null;
  active: number;
  created_at: string;
}

export interface ViewConfig {
  tabs: Array<'performance' | 'work-backwards' | 'planning'>;
  months: string[] | 'all';
  channels: string[] | 'all';
}

export type Stage = 'lead' | 'scheduled' | 'completed' | 'purchase';

export interface FunnelLabels {
  lead: string;
  scheduled: string;
  completed: string;
  purchase: string;
}

export const DEFAULT_FUNNEL_LABELS: FunnelLabels = {
  lead: 'Leads',
  scheduled: 'Scheduled',
  completed: 'Completed',
  purchase: 'Purchases',
};

export const HOME_SERVICES_FUNNEL_LABELS: FunnelLabels = {
  lead: 'Leads',
  scheduled: 'Jobs Booked',
  completed: 'Jobs Completed',
  purchase: 'Invoices Paid',
};

// Door to door: the funnel a knocking crew actually runs on. A "lead" is a
// door that was knocked, not a form fill, and the stages are the ones a
// setter and a closer are measured against.
export const DOOR_TO_DOOR_FUNNEL_LABELS: FunnelLabels = {
  lead: 'Knocks',
  scheduled: 'Appointments',
  completed: 'Sits',
  purchase: 'Sales',
};

export const BE_CLINICAL_FUNNEL_LABELS: FunnelLabels = {
  lead: 'Leads',
  scheduled: 'Booked',
  completed: 'Showed',
  purchase: 'Purchases',
};

export interface ThemeTokens {
  paper: string;
  card: string;
  ink: string;
  inkSoft: string;
  hairline: string;
  accent: string;
  accentSoft: string;
  positive: string;
  negative: string;
  amber: string;
  verifiedGreen: string;
  grayCheck: string;
  redCheck: string;
  channelGoogle: string;
  channelMeta: string;
  channelWebsite: string;
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
}

export const LETLOIS_THEME: ThemeTokens = {
  paper: '#F6F3EE',
  card: '#FFFFFF',
  ink: '#23201C',
  inkSoft: '#6F6A62',
  hairline: '#E7E1D8',
  accent: '#3F5A52',
  accentSoft: '#E9EEEB',
  positive: '#3F5A52',
  negative: '#B0644F',
  amber: '#A98142',
  verifiedGreen: '#4C7A5E',
  grayCheck: '#C9C3B8',
  redCheck: '#C0654E',
  channelGoogle: '#3F5A52',
  channelMeta: '#A98142',
  channelWebsite: '#9A9389',
  fontDisplay: 'Fraunces',
  fontBody: 'Spline Sans',
  fontMono: 'Spline Sans Mono',
};

// True when a stored theme is the untouched provisioning default, i.e. the
// tenant has never actually been branded. This matters because a theme is
// applied as inline CSS variables, which outrank the dark palette: a tenant
// carrying this light default renders light ink over the dark chrome that
// is not theme controlled (--sidebar-bg), and the nav goes unreadable. A
// default theme is treated as no theme so those tenants follow the app
// palette and dark mode works. Only the color tokens are compared; fonts
// are theme independent and safe either way.
export function isDefaultTheme(theme: Record<string, unknown> | null | undefined): boolean {
  if (!theme) return false;
  const colorKeys = (Object.keys(LETLOIS_THEME) as Array<keyof ThemeTokens>).filter(
    (k) => k !== 'fontDisplay' && k !== 'fontBody' && k !== 'fontMono'
  );
  // customCss or a wordmark is deliberate branding even when every color is
  // still the default, so such a theme is not "untouched".
  if (theme.customCss || theme.wordmark) return false;
  return colorKeys.every(
    (k) => String(theme[k] ?? '').toUpperCase() === LETLOIS_THEME[k].toUpperCase()
  );
}

export interface SessionRecord {
  // 'field' sessions ride a separate cookie from dashboard sessions and are
  // refused by every dashboard route. See fieldScope in the API middleware.
  userType: 'agency' | 'tenant' | 'field';
  userId: string;
  role: Role;
  tenantId: string | null;
  assignedTenants: string[] | null;
  csrf: string;
  createdAt: string;
}

export interface FieldRepRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: FieldRole;
  team: string | null;
  password_hash: string;
  active: number;
  last_login_at: string | null;
  created_at: string;
}

export interface SourceRow {
  key: string;
  name: string;
  kind: 'webhook' | 'pixel' | 'csv' | 'integration';
  connector_type: string | null;
  cadence: number;
  platform_link: string | null;
  how_to: string | null;
  signing_secret_hash: string | null;
  field_map_json: string | null;
  verified_by: string | null;
  verified_at: string | null;
  records_through: string | null;
  last_import_at: string | null;
  created_at: string;
}

export type SourceFreshness = 'gray' | 'green' | 'red';

// Freshness: red wins when the data is older than the cadence window,
// green when verified after the latest import, gray otherwise.
export function sourceFreshness(
  source: Pick<SourceRow, 'cadence' | 'verified_at' | 'last_import_at'>,
  now: Date = new Date()
): SourceFreshness {
  const cadenceDays = source.cadence || 7;
  const latest = source.last_import_at ? new Date(source.last_import_at) : null;
  if (latest) {
    const ageDays = (now.getTime() - latest.getTime()) / 86400000;
    if (ageDays > cadenceDays) return 'red';
  } else {
    return 'red';
  }
  if (source.verified_at && new Date(source.verified_at) >= latest) return 'green';
  return 'gray';
}

export interface DashboardLayout {
  cards: Array<{
    id: string;
    type: 'kpi' | 'channel-table' | 'cohort' | 'spend' | 'quality' | 'custom-kpi';
    visible: boolean;
    metricExpression?: string;
    label?: string;
  }>;
}

export const DEFAULT_LAYOUT: DashboardLayout = {
  cards: [
    { id: 'topline', type: 'kpi', visible: true },
    { id: 'channels', type: 'channel-table', visible: true },
    { id: 'cohort', type: 'cohort', visible: true },
    { id: 'spend', type: 'spend', visible: true },
    { id: 'quality', type: 'quality', visible: true },
  ],
};
