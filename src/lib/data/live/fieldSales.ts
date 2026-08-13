// The field-sales live adapter.
//
// The payoff for routing every module through one seam: no view changes to
// make this real. Dashboard, Canvass, Properties and Territories all still
// call useModuleData('field_sales') and are unaware that the doors now come
// from D1 rather than from a generator.
//
// The response is validated against the module's own wire contract, which the
// server produced it from, so a field renamed on one side fails here with a
// message naming it rather than three components deeper as an undefined.

import { api } from '@/lib/api/client';
import { apiPaths } from '@/lib/api/paths';
import { fieldSalesDataSchema } from '@/modules/field-sales/contracts';
import type { FieldSalesSlice } from '@/modules/field-sales/types';

/**
 * Fetch a client's doors, knocks, territories and crew.
 *
 * The wire shape and the module's slice are the same shape by construction:
 * if they ever diverge this assignment stops compiling, which is the point of
 * declaring the return type rather than inferring it.
 */
export async function fetchFieldSalesLive(
  clientId: string,
  signal?: AbortSignal
): Promise<FieldSalesSlice> {
  return api.get(apiPaths.fieldSalesData(clientId), fieldSalesDataSchema, signal);
}
