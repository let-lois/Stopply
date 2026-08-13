// One of the two sanctioned seams between platform code and module domains.
//
// Mapping ModuleId to each module's data interface is what makes
// useModuleData type-safe per module: asking for 'advertising' returns
// AdvertisingData and nothing else, so a view cannot quietly receive the
// wrong shape. Doing that requires importing module types from lib/, which
// the linter forbids everywhere except here and the registry.

import type { AdvertisingData } from '@/modules/advertising/types';
import type { FieldSalesData } from '@/modules/field-sales/types';
import type { EcommerceData } from '@/modules/ecommerce/types';
import type { LogisticsData } from '@/modules/logistics/types';
import type { CrmData } from '@/modules/crm/types';
import type { AnalyticsData } from '@/modules/analytics/types';
import type { ModuleId } from '@/types';

import { advertisingDemo } from '@/lib/data/demo/advertising';
import { fieldSalesDemo } from '@/lib/data/demo/fieldSales';
import { ecommerceDemo } from '@/lib/data/demo/ecommerce';
import { logisticsDemo } from '@/lib/data/demo/logistics';
import { crmDemo } from '@/lib/data/demo/crm';
import { analyticsDemo } from '@/lib/data/demo/analytics';

export interface ModuleDataMap {
  advertising: AdvertisingData;
  field_sales: FieldSalesData;
  ecommerce: EcommerceData;
  logistics: LogisticsData;
  crm: CrmData;
  analytics: AnalyticsData;
}

type DemoBuilders = { [M in ModuleId]: (clientId: string, now: Date) => ModuleDataMap[M] };

// Every builder takes the client id, so no two clients share a dataset. The
// prototype's modules imported a demo singleton at module scope, which is
// why switching the active client changed nothing on screen.
const DEMO_BUILDERS: DemoBuilders = {
  advertising: advertisingDemo,
  field_sales: fieldSalesDemo,
  ecommerce: ecommerceDemo,
  logistics: logisticsDemo,
  crm: crmDemo,
  analytics: analyticsDemo,
};

export function buildDemoData<M extends ModuleId>(
  moduleId: M,
  clientId: string,
  now: Date
): ModuleDataMap[M] {
  return DEMO_BUILDERS[moduleId](clientId, now);
}
