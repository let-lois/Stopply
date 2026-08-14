// Deterministic pseudo-randomness, seeded by client id.
//
// Demo data is generated per client rather than shared, because the
// prototype's five demo-importing modules rendered byte-identical dashboards
// for every client: switching the active client visibly changed nothing.
// Seeding by id means each client has its own consistent numbers, and the
// same client shows the same numbers on every load.

export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (const ch of seed) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function between(random: () => number, min: number, max: number): number {
  return Math.round(min + random() * (max - min));
}

export function pick<T>(random: () => number, list: readonly T[]): T {
  const index = Math.floor(random() * list.length);
  // noUncheckedIndexedAccess: the index is in range by construction, but the
  // compiler cannot know that, and a non-null assertion would be a lie if the
  // list were ever empty.
  const item = list[index] ?? list[0];
  if (item === undefined) throw new Error('pick() called with an empty list');
  return item;
}

/** ISO day keys ending today, oldest first. */
export function lastDays(count: number, now: Date): string[] {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    days.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return days;
}
