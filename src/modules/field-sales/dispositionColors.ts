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
  do_not_knock: '#f8fafc',
};
