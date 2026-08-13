// A colour per rep, and the tack that carries it.
//
// Colouring doors by outcome answers "what happened at this house". Colouring
// them by rep answers "who is working this street", which is the question a
// manager looking at a city actually has. Both are worth having and neither
// replaces the other.

/**
 * Distinguishable at a glance, on a dark map, next to each other.
 *
 * Deliberately not the disposition palette. If a rep were amber and
 * "come back later" were also amber, the two colourings would look like the
 * same information and mean different things.
 */
export const REP_PALETTE = [
  '#f472b6',
  '#22d3ee',
  '#a3e635',
  '#fb923c',
  '#818cf8',
  '#f87171',
  '#2dd4bf',
  '#facc15',
  '#c084fc',
  '#4ade80',
] as const;

/** For a door nobody has knocked yet, which has no rep to colour it by. */
export const UNWORKED_COLOR = '#64748b';

/**
 * Assign each rep a colour.
 *
 * By position in the roster sorted by id, so the same crew gets the same
 * colours on every load and a manager can learn them. The honest limitation:
 * adding a rep shifts the colours of those after them in that order. Storing a
 * colour on the rep is the fix if that ever matters more than the simplicity
 * of deriving it.
 */
export function repColors(reps: Array<{ id: string }>): Map<string, string> {
  const ordered = [...reps].sort((a, b) => a.id.localeCompare(b.id));
  return new Map(ordered.map((rep, i) => [rep.id, REP_PALETTE[i % REP_PALETTE.length]!]));
}

/**
 * Who last knocked each door.
 *
 * The latest visit wins, so a door reflects whoever worked it most recently
 * rather than whoever got there first. Doors with no visits are absent from
 * the map entirely, which is what leaves them grey.
 */
export function lastRepByProperty(
  visits: Array<{ propertyId: string; repId: string; occurredAt: string }>
): Map<string, string> {
  const latest = new Map<string, { repId: string; occurredAt: string }>();
  for (const visit of visits) {
    const held = latest.get(visit.propertyId);
    if (!held || visit.occurredAt > held.occurredAt) {
      latest.set(visit.propertyId, { repId: visit.repId, occurredAt: visit.occurredAt });
    }
  }
  return new Map([...latest].map(([propertyId, v]) => [propertyId, v.repId]));
}

/**
 * A map tack, drawn rather than shipped as an asset.
 *
 * One image per colour, generated once and handed to MapLibre. Drawing it
 * means a new rep colour needs no new file, and the shape reads as "somebody
 * was here" in a way a plain dot does not.
 *
 * Returns null where there is no canvas to draw on, which is the test
 * environment; callers fall back to circles rather than failing.
 */
export function tackImage(color: string, pixelRatio = 2): ImageData | null {
  const w = 18;
  const h = 24;
  const canvas = document.createElement('canvas');
  canvas.width = w * pixelRatio;
  canvas.height = h * pixelRatio;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);

  // A teardrop: a disc with a point pulled down to the coordinate it marks, so
  // the tip is the door and the head is the label.
  const cx = w / 2;
  const cy = w / 2;
  const r = w / 2 - 2;

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.85, Math.PI * 0.15);
  ctx.lineTo(cx, h - 1);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();
  // A dark rim, because two adjacent tacks of similar hue merge into one blob
  // without it.
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // The hole in the head, which is what makes it read as a pin rather than a
  // balloon.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
