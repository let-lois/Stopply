import type {
  FieldSalesData,
  Property,
  PropertyDisposition,
  Rep,
  Territory,
  Visit,
} from '@/modules/field-sales/types';
import { between, pick, rng } from '@/lib/data/demo/rng';

// Real coordinates, because the map projects against them. The prototype
// carried real Austin coordinates on every property and then positioned pins
// by array index, so the geography was decorative and the pins moved when the
// list was filtered.
//
// Riverside, California. The demo used Mesa, Arizona, which put a prospective
// client's first look at the product in the wrong state and, once clients
// carried a timezone, an hour off their own day as well.
const TERRITORY_SEEDS = [
  { id: 'ter_north', name: 'Riverside North', lat: 33.9806, lng: -117.4102 },
  { id: 'ter_central', name: 'Arlington', lat: 33.9418, lng: -117.4275 },
  { id: 'ter_south', name: 'La Sierra', lat: 33.9061, lng: -117.4783 },
];

const STREETS = [
  'Magnolia Ave', 'Arlington Ave', 'Van Buren Blvd', 'Central Ave', 'Chicago Ave',
  'Tyler St', 'Indiana Ave', 'La Sierra Ave',
];

const REP_NAMES = ['Dana Reyes', 'Marcus Hill', 'Priya Nair', 'Tyler Boone'];
const OWNER_FIRST = ['Jordan', 'Casey', 'Morgan', 'Riley', 'Avery', 'Quinn'];
const OWNER_LAST = ['Carter', 'Diaz', 'Fletcher', 'Osei', 'Nakamura', 'Bell'];

// Weighted the way a real day goes: most doors reach nobody, and a sale is
// uncommon enough that knocks per sale lands somewhere a manager would
// recognise rather than somewhere flattering.
const DISPOSITION_WEIGHTS: Array<[PropertyDisposition, number]> = [
  ['no_answer', 44],
  ['come_back', 12],
  ['not_interested', 20],
  ['interested', 10],
  ['appointment_set', 8],
  ['closed_sale', 4],
  ['do_not_knock', 2],
];

function weightedDisposition(random: () => number): PropertyDisposition {
  const total = DISPOSITION_WEIGHTS.reduce((n, [, w]) => n + w, 0);
  let roll = random() * total;
  for (const [key, weight] of DISPOSITION_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return 'no_answer';
}

export function fieldSalesDemo(clientId: string, now: Date): FieldSalesData {
  const random = rng(`field:${clientId}`);

  const reps: Rep[] = REP_NAMES.map((name, i) => ({
    id: `rep_${clientId}_${i}`,
    name,
    territoryId: TERRITORY_SEEDS[i % TERRITORY_SEEDS.length]?.id ?? null,
  }));

  const properties: Property[] = [];
  const territories: Territory[] = [];

  for (const [t, seed] of TERRITORY_SEEDS.entries()) {
    const rows = 6;
    const perRow = 9;
    // The territory's extent is derived from the block it actually contains,
    // so the map's projection has a real bounding box to work against.
    const north = seed.lat + rows * 0.0016;
    const south = seed.lat - 0.0008;
    const east = seed.lng + perRow * 0.0012;
    const west = seed.lng - 0.0008;

    territories.push({
      id: seed.id,
      name: seed.name,
      bounds: { north, south, east, west },
      boundary: [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
      ],
      repIds: reps[t] ? [reps[t].id] : [],
    });

    for (let r = 0; r < rows; r++) {
      const street = STREETS[(t * rows + r) % STREETS.length] ?? 'Main St';
      for (let n = 0; n < perRow; n++) {
        const visited = random() < 0.62;
        const ownerKnown = random() < 0.4;
        properties.push({
          id: `prop_${clientId}_${t}_${r}_${n}`,
          address: `${100 + t * 200 + r * 20 + n * 2} ${street}`,
          city: 'Riverside',
          state: 'CA',
          postalCode: '92503',
          lat: seed.lat + r * 0.0016,
          lng: seed.lng + n * 0.0012,
          territoryId: seed.id,
          disposition: visited ? weightedDisposition(random) : 'not_visited',
          ownerName: ownerKnown ? `${pick(random, OWNER_FIRST)} ${pick(random, OWNER_LAST)}` : null,
          ownerPhone: ownerKnown ? `951-555-${String(1000 + between(random, 0, 8999)).slice(-4)}` : null,
          notes: null,
        });
      }
    }
  }

  // One visit per property that has been worked, so every KPI the selectors
  // derive has a visit behind it. Nothing is stored pre-aggregated.
  const visits: Visit[] = properties
    .filter((p) => p.disposition !== 'not_visited')
    .map((p, i) => ({
      id: `visit_${clientId}_${i}`,
      propertyId: p.id,
      repId: pick(random, reps).id,
      disposition: p.disposition,
      notes: null,
      // Demo data does not pretend a rep looked at the drive. Null is "not
      // recorded", which is exactly what happened here.
      vehiclePresent: null,
      occurredAt: new Date(
        now.getTime() - between(random, 0, 27) * 86400000 - between(random, 0, 8) * 3600000
      ).toISOString(),
    }));

  return { properties, visits, territories, reps };
}
