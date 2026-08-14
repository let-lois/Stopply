// What each outcome looks like, in one place.
//
// This existed as three separate copies: two literal hex maps, in DoorMap and
// Canvass, and a CSS variable map in Dashboard. Adding the appointment_kept
// and appointment_missed stages meant editing all three, and the compiler only
// caught it because they were typed Record<PropertyDisposition, string>. The
// Dashboard one was Record<string, string> and would have gone quietly grey.
//
// The colours themselves now live in catalog.ts beside each outcome's rank and
// label, because those three facts about an outcome belong together, and
// because a catalog that comes from the BI platform carries its own. This file
// is the lookup, and the part that earns its place here is what it does when
// the catalog has no answer.
//
// Hex rather than CSS variables is not a stylistic choice: a MapLibre paint
// expression is evaluated on the GPU and cannot read a custom property. The
// variables are derived from these, so the map and the chart cannot drift.

import type { PropertyDisposition } from '@/modules/field-sales/types';
import {
  BUILTIN_CATALOG,
  FALLBACK_HEX,
  type DispositionCatalog,
} from '@/modules/field-sales/catalog';

export const DISPOSITION_HEX: Record<string, string> = BUILTIN_CATALOG.hexFor('dark');

export function dispositionHexFor(
  theme: 'dark' | 'light',
  catalog: DispositionCatalog = BUILTIN_CATALOG
): Record<string, string> {
  return catalog.hexFor(theme);
}

/**
 * The colour for one outcome, always an actual colour.
 *
 * A function and not an index, because the set of outcomes is open now. A
 * client of the BI platform can add one, and the platform lets them leave its
 * colour null. An index would hand `undefined` to MapLibre, which then draws
 * no tack at all, so the door would vanish from the map rather than appear in
 * an unexpected colour. Vanishing is the worse failure by some way: a rep
 * knocks that house twice.
 *
 * Unknown outcomes cycle FALLBACK_HEX by their position in the catalog, so
 * they stay distinguishable from each other and stable across renders.
 */
export function dispositionHex(
  disposition: PropertyDisposition,
  theme: 'dark' | 'light',
  catalog: DispositionCatalog = BUILTIN_CATALOG
): string {
  const declared = catalog.hexFor(theme)[disposition];
  if (declared) return declared;
  const index = catalog.entries.findIndex((e) => e.key === disposition);
  return FALLBACK_HEX[(index < 0 ? 0 : index) % FALLBACK_HEX.length]!;
}
