import type { Property, Territory } from '@/modules/field-sales/types';

// Projects real coordinates into the canvass view.
//
// The prototype positioned pins with `15 + ((idx * 23) % 70)` while every
// property carried real coordinates that were never read. Because idx came
// from the *filtered* array, filtering moved the pins: the same house jumped
// position when you narrowed to Appointment Set. Reps navigate by spatial
// memory, and a map whose geometry changes under a filter is worse than a
// list.
//
// This is a linear transform against the territory's own bounding box, so a
// pin's position depends on its coordinates and nothing else. Filtering
// cannot move it, because the filter is not an input.

export interface Projected {
  /** Percentage across the plot, 0 at the west edge. */
  xPct: number;
  /** Percentage down the plot, 0 at the north edge. */
  yPct: number;
}

const PADDING_PCT = 6;

export function projectToBounds(
  point: { lat: number; lng: number },
  bounds: Territory['bounds']
): Projected {
  const lngSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;

  // A degenerate territory (one property, or none) has no extent to project
  // against. Centring is the honest answer; dividing by zero is not.
  const x = lngSpan === 0 ? 0.5 : (point.lng - bounds.west) / lngSpan;
  const y = latSpan === 0 ? 0.5 : (bounds.north - point.lat) / latSpan;

  const scale = (v: number) => PADDING_PCT + clamp01(v) * (100 - PADDING_PCT * 2);
  return { xPct: scale(x), yPct: scale(y) };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/** The extent that actually contains these properties, for a whole-crew view. */
export function boundsFor(properties: Property[]): Territory['bounds'] {
  if (properties.length === 0) return { north: 1, south: 0, east: 1, west: 0 };
  const lats = properties.map((p) => p.lat);
  const lngs = properties.map((p) => p.lng);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}
