// Address normalization for door to door logging.
//
// Reps type addresses on a phone, at a door, in a hurry. The same house
// arrives as "123 N. Main Street", "123 n main st", and "123 N Main St
// Apt 2" on three different nights. Reporting is worthless if each of
// those becomes its own door, so every visit resolves to an address_key
// and rows collapse onto it.
//
// This is deliberately not a postal validation service. It never rejects
// what a rep typed and never rewrites it for display: the original text is
// stored as entered, and the key exists only to decide whether two entries
// mean the same door.

// USPS style suffix abbreviations, folded to one canonical form each. Only
// the suffixes that actually turn up on residential routes.
const STREET_SUFFIXES: Record<string, string> = {
  street: 'st',
  str: 'st',
  st: 'st',
  avenue: 'ave',
  aven: 'ave',
  av: 'ave',
  ave: 'ave',
  road: 'rd',
  rd: 'rd',
  drive: 'dr',
  dr: 'dr',
  lane: 'ln',
  ln: 'ln',
  court: 'ct',
  ct: 'ct',
  circle: 'cir',
  cir: 'cir',
  boulevard: 'blvd',
  blvd: 'blvd',
  place: 'pl',
  pl: 'pl',
  terrace: 'ter',
  ter: 'ter',
  trail: 'trl',
  trl: 'trl',
  parkway: 'pkwy',
  pkwy: 'pkwy',
  highway: 'hwy',
  hwy: 'hwy',
  way: 'way',
  loop: 'loop',
  square: 'sq',
  sq: 'sq',
  point: 'pt',
  pt: 'pt',
  ridge: 'rdg',
  rdg: 'rdg',
};

const DIRECTIONALS: Record<string, string> = {
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
  n: 'n',
  s: 's',
  e: 'e',
  w: 'w',
  ne: 'ne',
  nw: 'nw',
  se: 'se',
  sw: 'sw',
};

// Unit designators are stripped from the street line when a rep typed the
// unit inline ("123 Main St Apt 4"), because the unit travels in its own
// field. Whichever way it was entered, the key comes out the same.
const UNIT_WORDS = new Set([
  'apt',
  'apartment',
  'unit',
  'ste',
  'suite',
  'bldg',
  'building',
  'lot',
  'trlr',
  'trailer',
  'rm',
  'room',
  '#',
]);

export interface AddressInput {
  street: string;
  unit?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

export interface NormalizedAddress {
  key: string;
  street: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

function squash(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    // Punctuation reps type inconsistently: periods after "N.", commas
    // between the street and the city, hyphens in "Twenty-One".
    .replace(/[.,'"]/g, '')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Splits a street line into its tokens and pulls out any inline unit.
function splitStreet(raw: string): { tokens: string[]; inlineUnit: string | null } {
  const tokens = squash(raw).split(' ').filter(Boolean);
  const out: string[] = [];
  let inlineUnit: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    // "#4" arrives as one token, "apt 4" and "# 4" as two.
    if (token.startsWith('#') && token.length > 1) {
      inlineUnit = token.slice(1);
      continue;
    }
    if (UNIT_WORDS.has(token)) {
      const next = tokens[i + 1];
      // A trailing unit word with nothing after it is noise, not a unit.
      if (next) {
        inlineUnit = next;
        i++;
      }
      continue;
    }
    out.push(token);
  }

  return { tokens: out, inlineUnit };
}

function canonicalStreetTokens(tokens: string[]): string[] {
  return tokens.map((token, index) => {
    // A leading token is the house number, never a directional to fold.
    if (index > 0 && DIRECTIONALS[token]) return DIRECTIONALS[token];
    if (index > 0 && STREET_SUFFIXES[token]) return STREET_SUFFIXES[token];
    return token;
  });
}

// The key that decides whether two entries are the same door.
//
// Postal code is preferred as the locality half because reps get it right
// far more often than they get city spelling right, and it is unambiguous
// across the state line. City plus state is the fallback when no zip was
// captured, and a street with neither still keys on the street alone: a
// crew works one area at a time, so collisions within a tenant are rare
// and a merged door is a better failure than a duplicated one.
export function addressKey(input: AddressInput): string {
  const { tokens, inlineUnit } = splitStreet(input.street);
  const street = canonicalStreetTokens(tokens).join(' ');
  const unit = squash(input.unit) || inlineUnit || '';
  const postal = squash(input.postalCode).replace(/\s/g, '').slice(0, 5);
  const locality = postal || [squash(input.city), squash(input.state)].filter(Boolean).join(' ');
  return [street, unit, locality].filter(Boolean).join('|');
}

// Normalizes for storage: the key plus trimmed, display ready fields. The
// street stays as the rep typed it apart from whitespace, so the address on
// a report reads the way the person who knocked it wrote it down.
export function normalizeAddress(input: AddressInput): NormalizedAddress {
  const { inlineUnit } = splitStreet(input.street);
  const trimmed = (v: string | null | undefined): string | null => {
    const s = (v ?? '').trim().replace(/\s+/g, ' ');
    return s.length > 0 ? s : null;
  };
  return {
    key: addressKey(input),
    street: trimmed(input.street) ?? '',
    unit: trimmed(input.unit) ?? (inlineUnit ? inlineUnit.toUpperCase() : null),
    city: trimmed(input.city),
    state: trimmed(input.state)?.toUpperCase() ?? null,
    postalCode: trimmed(input.postalCode),
  };
}

// One line rendering for report tables and the field app's history list.
export function formatAddress(a: {
  street: string;
  unit?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): string {
  const line1 = [a.street, a.unit ? `#${String(a.unit).replace(/^#/, '')}` : null]
    .filter(Boolean)
    .join(' ');
  const line2 = [a.city, [a.state, a.postalCode].filter(Boolean).join(' ')]
    .filter((p) => p && String(p).trim().length > 0)
    .join(', ');
  return [line1, line2].filter((p) => p.length > 0).join(', ');
}

// Straight line distance in meters between the door and where the phone
// actually was. Reporting flags a visit logged far from its address rather
// than blocking it: signal drops, phones fall back to tower level fixes,
// and a rep should never be stopped from logging a real knock.
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
