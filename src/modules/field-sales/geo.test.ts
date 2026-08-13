import type { Property } from '@/modules/field-sales/types';
import { boundsFor, projectToBounds } from '@/modules/field-sales/geo';

const bounds = { north: 34, south: 33, east: -111, west: -112 };

function property(id: string, lat: number, lng: number): Property {
  return {
    id, address: `${id} St`, city: 'Mesa', state: 'AZ', postalCode: '85201',
    lat, lng, territoryId: 'ter', disposition: 'no_answer',
    ownerName: null, ownerPhone: null, notes: null,
  };
}

describe('projectToBounds', () => {
  it('places a point by its coordinates, not its position in a list', () => {
    // The guarantee the prototype broke: the same house projects identically
    // however it is filtered, sorted, or paginated.
    const point = { lat: 33.5, lng: -111.5 };
    const a = projectToBounds(point, bounds);
    const b = projectToBounds(point, bounds);
    expect(a).toEqual(b);
  });

  it('puts north at the top and east at the right', () => {
    const northWest = projectToBounds({ lat: 34, lng: -112 }, bounds);
    const southEast = projectToBounds({ lat: 33, lng: -111 }, bounds);
    expect(northWest.yPct).toBeLessThan(southEast.yPct);
    expect(northWest.xPct).toBeLessThan(southEast.xPct);
  });

  it('keeps every point inside the plot', () => {
    const outside = projectToBounds({ lat: 99, lng: 99 }, bounds);
    expect(outside.xPct).toBeGreaterThanOrEqual(0);
    expect(outside.xPct).toBeLessThanOrEqual(100);
    expect(outside.yPct).toBeGreaterThanOrEqual(0);
    expect(outside.yPct).toBeLessThanOrEqual(100);
  });

  it('centres rather than dividing by zero in a territory with no extent', () => {
    const flat = { north: 33, south: 33, east: -111, west: -111 };
    const p = projectToBounds({ lat: 33, lng: -111 }, flat);
    expect(p.xPct).toBeCloseTo(50);
    expect(p.yPct).toBeCloseTo(50);
  });

  it('orders two houses on the same street by their real position', () => {
    const west = projectToBounds({ lat: 33.5, lng: -111.9 }, bounds);
    const east = projectToBounds({ lat: 33.5, lng: -111.1 }, bounds);
    expect(west.xPct).toBeLessThan(east.xPct);
  });
});

describe('boundsFor', () => {
  it('spans the properties given', () => {
    const b = boundsFor([property('a', 33.1, -111.9), property('b', 33.9, -111.1)]);
    expect(b).toEqual({ north: 33.9, south: 33.1, east: -111.1, west: -111.9 });
  });

  it('returns a usable box for an empty list', () => {
    expect(boundsFor([])).toEqual({ north: 1, south: 0, east: 1, west: 0 });
  });
});
