// What each outcome looks like, in one place.
//
// This existed as three separate copies: two literal hex maps, in DoorMap and
// Canvass, and a CSS variable map in Dashboard. Adding the appointment_kept
// and appointment_missed stages meant editing all three, and the compiler only
// caught it because they were typed Record<PropertyDisposition, string>. The
// Dashboard one was Record<string, string> and would have gone quietly grey.
//
// Hex rather than CSS variables is not a stylistic choice: a MapLibre paint
// expression is evaluated on the GPU and cannot read a custom property. The
// variables are derived from these, so the map and the chart cannot drift.

import type { PropertyDisposition } from '@/modules/field-sales/types';

export const DISPOSITION_HEX: Record<PropertyDisposition, string> = {
  not_visited: '#6b7280',
  no_answer: '#94a3b8',
  come_back: '#f59e0b',
  not_interested: '#ef4444',
  interested: '#38bdf8',
  appointment_set: '#a855f7',
  // The two halves of the appointment. Indigo reads as a neighbour of the
  // purple it came from, rose as a neighbour of the red that means no.
  appointment_kept: '#6366f1',
  appointment_missed: '#fb7185',
  closed_sale: '#10b981',
  // Near-white, so it is the one outcome that stands apart from every hue
  // rather than joining the spectrum. That works on a dark ground and is
  // literally invisible on a light one, which is why the light override below
  // exists at all.
  do_not_knock: '#f8fafc',
};

/**
 * The light-theme overrides, and only the ones that need it.
 *
 * A partial map rather than a second full palette. Nine of these ten colours
 * are mid-tone saturated hues that read on white as well as they do on slate,
 * and duplicating them would only create nine more chances for the two copies
 * to drift. What genuinely breaks on a light ground is stated here and
 * nowhere else.
 */
const LIGHT_OVERRIDES: Partial<Record<PropertyDisposition, string>> = {
  // Near-white on white. Inverted to the same idea: the one outcome that is
  // not a hue, read against the opposite ground.
  do_not_knock: '#1f2937',
  // Pale enough on white to read as "no data" rather than as a door somebody
  // knocked and got no answer at.
  no_answer: '#64748b',
  interested: '#0ea5e9',
};

export function dispositionHexFor(theme: 'dark' | 'light'): Record<PropertyDisposition, string> {
  if (theme !== 'light') return DISPOSITION_HEX;
  return { ...DISPOSITION_HEX, ...LIGHT_OVERRIDES };
}
