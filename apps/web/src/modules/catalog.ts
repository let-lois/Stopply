// The part of the registry that is data rather than interface.
//
// The registry proper imports React and lucide-react, which a Worker has no
// business bundling. But the server does need a module's display name, for the
// audit trail: "Enabled Field Sales" reads to a person, "Enabled field_sales"
// reads to a developer.
//
// Writing that name a second time on the server would put the registry's
// single-source-of-truth property back where the prototype had it, where two
// copies agree until one of them is edited. So the names live here, in a file
// with no imports and no runtime, and the registry reads them.

import type { ModuleId } from '@/types';

export const MODULE_NAMES: Record<ModuleId, string> = {
  advertising: 'Advertising',
  field_sales: 'Field Sales',
  ecommerce: 'Ecommerce',
  logistics: 'Logistics',
  crm: 'CRM',
  analytics: 'Analytics',
};

// URL slugs are deliberately NOT here. src/types/routes.ts already owns them,
// as a typed union with a reverse map, and a second copy in this file would
// reintroduce exactly the drift this file exists to prevent.

/** Nav order, and the priority used to pick a client's landing view. */
export const MODULE_ORDER: ModuleId[] = [
  'advertising',
  'field_sales',
  'ecommerce',
  'logistics',
  'crm',
  'analytics',
];

/** Undefined for an id that is not a module, which callers must handle. */
export function moduleName(id: string): string | undefined {
  return MODULE_NAMES[id as ModuleId];
}
