// Every path in the application, in one place.
//
// The prototype navigated with useState<string> and eighteen magic strings
// threaded through props. There were no URLs, no deep links, no back button,
// and setActiveTab('field_dashbord') compiled clean. Here a route is a
// builder, a typo is a compile error, and the linter refuses a literal path
// in a `to` prop or a navigate() call.

import type { ModuleId } from '@/types';

export const PLATFORM_ROUTES = [
  'clients',
  'team',
  'audit',
  'credentials',
  'settings',
  'prototypes',
] as const;
export type PlatformRoute = (typeof PLATFORM_ROUTES)[number];

// Path *patterns*, for the router's route definitions. Distinct from the
// builders below, which produce concrete hrefs.
export const ROUTE_PATTERNS = {
  root: '/',
  clients: '/clients',
  team: '/team',
  audit: '/audit',
  credentials: '/credentials',
  settings: '/settings',
  workspace: '/c/:clientId',
  workspaceSettings: '/c/:clientId/settings',
  login: '/login',
  field: '/field',
  prototypes: '/prototypes',
  /**
   * One app, framed at a device size.
   *
   * Outside the app shell rather than inside it: a phone frame needs the
   * whole viewport, and the dashboard's nav and header around a drawing of a
   * phone is chrome around chrome.
   */
  prototype: '/prototypes/:appId',
  workspaceModule: '/c/:clientId/:moduleId',
  workspaceView: '/c/:clientId/:moduleId/:viewId',
} as const;

/**
 * The module segment as it appears in a URL.
 *
 * ModuleId uses snake_case because it keys the registry and the data map;
 * URLs read better in kebab-case. The two are converted only here, so no
 * component ever has to know that `field_sales` is `field-sales` in a path.
 */
export type ModuleSlug =
  | 'advertising'
  | 'field-sales'
  | 'ecommerce'
  | 'logistics'
  | 'crm'
  | 'analytics';

const MODULE_SLUGS: Record<ModuleId, ModuleSlug> = {
  advertising: 'advertising',
  field_sales: 'field-sales',
  ecommerce: 'ecommerce',
  logistics: 'logistics',
  crm: 'crm',
  analytics: 'analytics',
};

const MODULE_IDS_BY_SLUG: Record<ModuleSlug, ModuleId> = {
  advertising: 'advertising',
  'field-sales': 'field_sales',
  ecommerce: 'ecommerce',
  logistics: 'logistics',
  crm: 'crm',
  analytics: 'analytics',
};

export function moduleSlug(id: ModuleId): ModuleSlug {
  return MODULE_SLUGS[id];
}

/** Undefined for anything that is not a module, so the guard can 404 it. */
export function moduleIdFromSlug(slug: string): ModuleId | undefined {
  return MODULE_IDS_BY_SLUG[slug as ModuleSlug];
}

export const routes = {
  root: () => '/',
  login: () => '/login',
  field: () => '/field',
  clients: () => '/clients',
  team: () => '/team',
  audit: () => '/audit',
  credentials: () => '/credentials',
  settings: () => '/settings',
  prototypes: () => '/prototypes',
  prototype: (appId: string) => `/prototypes/${encodeURIComponent(appId)}`,
  workspaceSettings: (clientId: string) => `/c/${clientId}/settings`,
  /**
   * A workspace's front door, which redirects to its first enabled module.
   *
   * Exists because a client-scoped user has no client list to go home to: the
   * header's mark has to lead somewhere they are allowed to be.
   */
  workspaceIndex: (clientId: string) => `/c/${clientId}`,
  /**
   * `viewId` is typed at the call site by the registry: the workspace nav and
   * defaultViewFor both derive it from MODULE_REGISTRY[moduleId].views, so a
   * view that does not exist cannot be linked to.
   */
  workspace: (clientId: string, moduleId: ModuleId, viewId: string) =>
    `/c/${clientId}/${moduleSlug(moduleId)}/${viewId}`,
} as const;

export type RouteBuilder = typeof routes;
