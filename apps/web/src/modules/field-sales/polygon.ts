// Territory geometry.
//
// A territory is a drawn shape, not a rectangle. Real ones follow streets, a
// canal, one side of a highway; a bounding box around such a shape sweeps in
// every door on the wrong side of the road and hands them to the wrong rep.
//
// Pure functions, in the module that owns the domain, so the server that
// assigns doors and the browser that draws the shape agree by construction
// rather than by two people implementing the same maths.

/** A single ring, [lng, lat], in the order the manager drew it. */
export type Ring = Array<[number, number]>;

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Three points is the fewest that enclose any area at all. */
export function isUsableRing(ring: Ring): boolean {
  return Array.isArray(ring) && ring.length >= 3 && ring.every(
    ([lng, lat]) =>
      Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

/**
 * Is this point inside the ring?
 *
 * Ray casting: count how many edges a ray from the point crosses. Odd means
 * inside. Cheap, exact for the flat-earth approximation a neighbourhood-sized
 * territory lives in, and no dependency.
 *
 * A door exactly on an edge is deliberately not special-cased. Whichever way
 * it falls it lands in exactly one territory, which is what the caller needs;
 * being precise about the boundary of a hand-drawn shape is false precision.
 */
export function containsPoint(ring: Ring, point: { lat: number; lng: number }): boolean {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;

    const [aLng, aLat] = a;
    const [bLng, bLat] = b;

    const straddles = aLat > point.lat !== bLat > point.lat;
    if (!straddles) continue;

    // Longitude of the edge at this point's latitude.
    const crossingLng = ((bLng - aLng) * (point.lat - aLat)) / (bLat - aLat) + aLng;
    if (point.lng < crossingLng) inside = !inside;
  }

  return inside;
}

/**
 * The ring's bounding box.
 *
 * Stored alongside the ring, and derived from it on every write rather than
 * edited separately. It is an index, not a second definition: the map frames
 * itself with it and a query can use it to skip territories a door cannot
 * possibly be in, but nothing decides membership with it.
 */
export function boundsOf(ring: Ring): Bounds {
  const lngs = ring.map(([lng]) => lng);
  const lats = ring.map(([, lat]) => lat);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

/**
 * Which territory owns this door.
 *
 * First match wins when shapes overlap, which they will: a manager dragging a
 * boundary is not doing computational geometry, and two territories sharing a
 * street corner is normal. A door belongs to exactly one rep, so the tie has
 * to be broken somewhere, and doing it in one place beats leaving each caller
 * to invent an answer.
 */
export function territoryFor<T extends { id: string; boundary: Ring | null }>(
  territories: T[],
  point: { lat: number; lng: number }
): T | undefined {
  return territories.find((t) => t.boundary && containsPoint(t.boundary, point));
}
