// Territory geometry.
//
// Every door in a client's book gets assigned by these functions, so a wrong
// answer here hands houses to the wrong rep and nothing else in the system
// would notice.

import { boundsOf, containsPoint, isUsableRing, territoryFor, type Ring } from '@/modules/field-sales/polygon';

// A square over east Mesa, drawn anticlockwise as a manager dragging left to
// right would produce.
const SQUARE: Ring = [
  [-111.66, 33.4],
  [-111.6, 33.4],
  [-111.6, 33.44],
  [-111.66, 33.44],
];

// The shape a bounding box gets wrong: an L, where the notch is the far side
// of a highway and belongs to somebody else.
const L_SHAPE: Ring = [
  [-111.66, 33.4],
  [-111.62, 33.4],
  [-111.62, 33.42],
  [-111.6, 33.42],
  [-111.6, 33.44],
  [-111.66, 33.44],
];

describe('isUsableRing', () => {
  it('needs three points to enclose anything', () => {
    expect(isUsableRing([[-111.6, 33.4]])).toBe(false);
    expect(
      isUsableRing([
        [-111.6, 33.4],
        [-111.6, 33.5],
      ])
    ).toBe(false);
    expect(isUsableRing(SQUARE)).toBe(true);
  });

  it('refuses coordinates that are not on Earth', () => {
    // A transposed pair, which is the most common way this goes wrong: a
    // latitude of -111 is not a place, and silently accepting it would put a
    // territory somewhere nobody can knock.
    expect(
      isUsableRing([
        [33.4, -111.66],
        [33.4, -111.6],
        [33.44, -111.6],
      ])
    ).toBe(false);
    expect(isUsableRing([[NaN, 33.4], [-111.6, 33.4], [-111.6, 33.44]])).toBe(false);
  });
});

describe('containsPoint', () => {
  it('finds a door in the middle', () => {
    expect(containsPoint(SQUARE, { lat: 33.42, lng: -111.63 })).toBe(true);
  });

  it('leaves out a door beyond every edge', () => {
    expect(containsPoint(SQUARE, { lat: 33.45, lng: -111.63 })).toBe(false);
    expect(containsPoint(SQUARE, { lat: 33.39, lng: -111.63 })).toBe(false);
    expect(containsPoint(SQUARE, { lat: 33.42, lng: -111.59 })).toBe(false);
    expect(containsPoint(SQUARE, { lat: 33.42, lng: -111.67 })).toBe(false);
  });

  it('respects a notch a bounding box would swallow', () => {
    // This is the whole reason territories are drawn rather than boxed. The
    // point sits inside the L's bounding box and outside the L.
    const inNotch = { lat: 33.41, lng: -111.605 };
    const box = boundsOf(L_SHAPE);

    expect(inNotch.lat).toBeGreaterThan(box.south);
    expect(inNotch.lat).toBeLessThan(box.north);
    expect(inNotch.lng).toBeGreaterThan(box.west);
    expect(inNotch.lng).toBeLessThan(box.east);

    expect(containsPoint(L_SHAPE, inNotch)).toBe(false);
    expect(containsPoint(L_SHAPE, { lat: 33.41, lng: -111.64 })).toBe(true);
  });

  it('does not care which way the ring was drawn', () => {
    // A manager dragging clockwise and one dragging anticlockwise describe the
    // same territory, and ray casting is indifferent to winding. Worth pinning
    // because plenty of geometry code is not.
    const reversed = [...SQUARE].reverse();
    expect(containsPoint(reversed, { lat: 33.42, lng: -111.63 })).toBe(true);
  });
});

describe('boundsOf', () => {
  it('is the tightest box around the ring', () => {
    expect(boundsOf(SQUARE)).toEqual({
      north: 33.44,
      south: 33.4,
      east: -111.6,
      west: -111.66,
    });
  });
});

describe('territoryFor', () => {
  const territories = [
    { id: 'ter_north', boundary: SQUARE },
    {
      id: 'ter_south',
      boundary: [
        [-111.66, 33.36],
        [-111.6, 33.36],
        [-111.6, 33.4],
        [-111.66, 33.4],
      ] as Ring,
    },
    { id: 'ter_none', boundary: null },
  ];

  it('picks the territory a door falls in', () => {
    expect(territoryFor(territories, { lat: 33.42, lng: -111.63 })?.id).toBe('ter_north');
    expect(territoryFor(territories, { lat: 33.38, lng: -111.63 })?.id).toBe('ter_south');
  });

  it('returns nothing for a door outside every territory', () => {
    // The caller has to handle this: a door outside every shape keeps whatever
    // territory it already had rather than being orphaned.
    expect(territoryFor(territories, { lat: 34.5, lng: -112.5 })).toBeUndefined();
  });

  it('skips a territory that has no shape rather than throwing', () => {
    expect(() => territoryFor(territories, { lat: 33.42, lng: -111.63 })).not.toThrow();
  });

  it('breaks a tie the same way every time', () => {
    // Overlapping territories are normal: a manager dragging boundaries is not
    // doing computational geometry. A door belongs to one rep, so the tie has
    // to break somewhere, and it has to break consistently or doors would
    // shuffle between reps on every save.
    const overlapping = [
      { id: 'ter_a', boundary: SQUARE },
      { id: 'ter_b', boundary: SQUARE },
    ];
    const door = { lat: 33.42, lng: -111.63 };
    expect(territoryFor(overlapping, door)?.id).toBe('ter_a');
    expect(territoryFor(overlapping, door)?.id).toBe('ter_a');
  });
});
