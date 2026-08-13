// The single source of truth for every module.
//
// The prototype's registry declared defaultRoute, iconName and color, and all
// three were dead. defaultRoute used a different vocabulary from the actual
// route strings. iconName was a string while the sidebar kept its own
// ModuleId-to-icon switch. color was duplicated inline in ClientsPage as a
// ternary chain whose fallback gave purple to both crm and analytics, so
// analytics rendered the wrong colour while the registry said rose.
//
// Everything now derives from here: nav, badges, icons, route generation, and
// the default landing view. No component may hardcode a module's name, icon,
// colour, or route.

import { lazy } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, DoorOpen, Megaphone, ShoppingCart, Truck, Users } from 'lucide-react';
import type { ModuleId } from '@/types';
import type { AccentToken } from '@/types/accent';
import { MODULE_NAMES, MODULE_ORDER } from '@/modules/catalog';

export interface ModuleViewDef {
  label: string;
  Component: React.ComponentType;
  /** Whether the workspace nav offers it. */
  showInNav: boolean;
}

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  tagline: string;
  description: string;
  Icon: LucideIcon;
  accent: AccentToken;
  supportedIntegrations: string[];
  /** Must be a key of `views`; asserted by a test rather than by a comment. */
  defaultView: string;
  views: Record<string, ModuleViewDef>;
}

// Views load on demand. Importing them eagerly would pull every chart into
// the bundle the sidebar needs on first paint.
const AdvertisingDashboard = lazy(() => import('@/modules/advertising/views/Dashboard'));
const AdvertisingCampaigns = lazy(() => import('@/modules/advertising/views/Campaigns'));
const AdvertisingLeads = lazy(() => import('@/modules/advertising/views/Leads'));
const FieldSalesDashboard = lazy(() => import('@/modules/field-sales/views/Dashboard'));
const FieldSalesCanvass = lazy(() => import('@/modules/field-sales/views/Canvass'));
const FieldSalesProperties = lazy(() => import('@/modules/field-sales/views/Properties'));
const FieldSalesTerritories = lazy(() => import('@/modules/field-sales/views/Territories'));
const EcommerceDashboard = lazy(() => import('@/modules/ecommerce/views/Dashboard'));
const EcommerceOrders = lazy(() => import('@/modules/ecommerce/views/Orders'));
const LogisticsDashboard = lazy(() => import('@/modules/logistics/views/Dashboard'));
const CrmPipeline = lazy(() => import('@/modules/crm/views/Pipeline'));
const AnalyticsOverview = lazy(() => import('@/modules/analytics/views/Overview'));

export const MODULE_REGISTRY: Record<ModuleId, ModuleDefinition> = {
  advertising: {
    id: 'advertising',
    name: MODULE_NAMES.advertising,
    tagline: 'Spend, leads and return',
    description: 'Campaign performance across paid channels, with the leads each one produced.',
    Icon: Megaphone,
    accent: 'emerald',
    supportedIntegrations: ['Meta Ads', 'Google Ads'],
    defaultView: 'dashboard',
    views: {
      dashboard: { label: 'Dashboard', Component: AdvertisingDashboard, showInNav: true },
      campaigns: { label: 'Campaigns', Component: AdvertisingCampaigns, showInNav: true },
      leads: { label: 'Leads', Component: AdvertisingLeads, showInNav: true },
    },
  },
  field_sales: {
    id: 'field_sales',
    name: MODULE_NAMES.field_sales,
    tagline: 'Doors, outcomes and territory',
    description: 'What the crew knocked, what came of it, and which streets are still open.',
    Icon: DoorOpen,
    accent: 'amber',
    supportedIntegrations: ['Field Maps'],
    defaultView: 'dashboard',
    views: {
      dashboard: { label: 'Dashboard', Component: FieldSalesDashboard, showInNav: true },
      canvass: { label: 'Canvass', Component: FieldSalesCanvass, showInNav: true },
      properties: { label: 'Properties', Component: FieldSalesProperties, showInNav: true },
      territories: { label: 'Territories', Component: FieldSalesTerritories, showInNav: true },
    },
  },
  ecommerce: {
    id: 'ecommerce',
    name: MODULE_NAMES.ecommerce,
    tagline: 'Orders and revenue',
    description: 'Store performance and the order book behind it.',
    Icon: ShoppingCart,
    accent: 'sky',
    supportedIntegrations: ['Shopify', 'Stripe'],
    defaultView: 'dashboard',
    views: {
      dashboard: { label: 'Dashboard', Component: EcommerceDashboard, showInNav: true },
      orders: { label: 'Orders', Component: EcommerceOrders, showInNav: true },
    },
  },
  logistics: {
    id: 'logistics',
    name: MODULE_NAMES.logistics,
    tagline: 'Shipments in flight',
    description: 'Where every shipment is, and which ones need attention.',
    Icon: Truck,
    accent: 'indigo',
    supportedIntegrations: ['Carrier API'],
    defaultView: 'dashboard',
    views: {
      dashboard: { label: 'Dashboard', Component: LogisticsDashboard, showInNav: true },
    },
  },
  crm: {
    id: 'crm',
    name: MODULE_NAMES.crm,
    tagline: 'Pipeline and deals',
    description: 'Deals by stage, and what the open pipeline is worth.',
    Icon: Users,
    accent: 'purple',
    supportedIntegrations: [],
    defaultView: 'pipeline',
    views: {
      pipeline: { label: 'Pipeline', Component: CrmPipeline, showInNav: true },
    },
  },
  analytics: {
    id: 'analytics',
    name: MODULE_NAMES.analytics,
    // rose, as the prototype's registry always said. Its ClientsPage ternary
    // fell through to purple and rendered this module the wrong colour.
    tagline: 'Traffic and conversion',
    description: 'Sessions, conversions and where they came from.',
    Icon: BarChart3,
    accent: 'rose',
    supportedIntegrations: [],
    defaultView: 'overview',
    views: {
      overview: { label: 'Overview', Component: AnalyticsOverview, showInNav: true },
    },
  },
};

/**
 * Undefined for an id that is not a module.
 *
 * Deliberately nullable, unlike the prototype's getModuleById, which was
 * typed non-nullable and lied. With noUncheckedIndexedAccess on, callers have
 * to handle the miss, which is what lets the router 404 an unknown module
 * rather than falling through to another one's view.
 */
export function getModule(id: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY[id as ModuleId];
}

export function getView(moduleId: ModuleId, viewId: string): ModuleViewDef | undefined {
  return MODULE_REGISTRY[moduleId].views[viewId];
}

// Nav order and display names come from the catalog, which has no React and
// no icons in it, so the server can read them for the audit trail without
// bundling this file. Re-exported here so every existing call site keeps
// importing them from the registry.
export { MODULE_ORDER, MODULE_NAMES } from '@/modules/catalog';

/**
 * The view a client lands on, in one place.
 *
 * The prototype had this same six-branch chain twice: once in an App effect
 * and once in ClientsPage. Clicking Open Workspace ran both, and the effect
 * won, making the other dead code. They agreed by coincidence, which is what
 * made it a trap rather than a bug.
 */
export function defaultViewFor(
  enabledModules: ModuleId[]
): { moduleId: ModuleId; viewId: string } | undefined {
  const moduleId = MODULE_ORDER.find((id) => enabledModules.includes(id));
  if (!moduleId) return undefined;
  return { moduleId, viewId: MODULE_REGISTRY[moduleId].defaultView };
}
