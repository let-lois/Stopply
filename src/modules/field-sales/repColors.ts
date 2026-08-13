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
  '#38bdf8',
  '#fda4af',
  '#86efac',
  '#fcd34d',
  '#a78bfa',
  '#5eead4',
] as const;

/** For a door nobody has knocked yet, which has no rep to colour it by. */
export const UNWORKED_COLOR = '#64748b';

/** FNV-1a, 32-bit. Small, stable, and not a security boundary. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Assign each rep a colour.
 *
 * From a hash of the rep's id, not their position in the roster. Position was
 * simpler and was wrong in a way that only shows up on a growing crew: sorting
 * by id and indexing into the palette means hiring one rep re-colours everyone
 * after them, so the whole map changes meaning overnight and the colours a
 * manager had learned now belong to somebody else. A hash gives each rep a
 * colour they keep for as long as they have the id.
 *
 * The trade is collisions. Past sixteen reps two of them share a colour, and
 * even below that a hash can land twice in the same bucket. So a second pass
 * moves a colliding rep to the nearest free colour, in id order, which keeps
 * every rep on the current roster distinct while leaving everyone who did not
 * collide exactly where they were. Beyond a full palette collisions are
 * unavoidable and the legend, which names every rep, is what disambiguates.
 */
export function repColors(reps: Array<{ id: string }>): Map<string, string> {
  const ordered = [...reps].sort((a, b) => a.id.localeCompare(b.id));
  const taken = new Set<number>();
  const assigned = new Map<string, string>();

  for (const rep of ordered) {
    const preferred = hash(rep.id) % REP_PALETTE.length;
    let index = preferred;
    // Only walks when the preferred slot is gone, so a rep whose colour is
    // free keeps it no matter who else joins.
    for (let step = 0; step < REP_PALETTE.length && taken.has(index); step++) {
      index = (preferred + step + 1) % REP_PALETTE.length;
    }
    taken.add(index);
    assigned.set(rep.id, REP_PALETTE[index]!);
  }

  return assigned;
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
