// Rep colours have one job beyond being distinguishable: staying put.
//
// A manager learns "the pink tacks are Marcus". If hiring somebody re-colours
// half the crew, the map silently starts lying to a reader who learned it
// yesterday, and there is nothing on screen to tell them. The market is
// expanding and the crew is about to grow, so this is the test that matters.

import { lastRepByProperty, repColors, REP_PALETTE } from '@/modules/field-sales/repColors';

const rep = (id: string) => ({ id });

describe('repColors', () => {
  it('keeps every existing rep on their colour when somebody is hired', () => {
    const before = repColors(['rep_a', 'rep_b', 'rep_c', 'rep_d'].map(rep));
    const after = repColors(['rep_a', 'rep_b', 'rep_c', 'rep_d', 'rep_aa'].map(rep));

    for (const [id, color] of before) {
      expect(after.get(id)).toBe(color);
    }
  });

  it('keeps every remaining rep on their colour when somebody leaves', () => {
    const before = repColors(['rep_a', 'rep_b', 'rep_c', 'rep_d'].map(rep));
    const after = repColors(['rep_a', 'rep_c', 'rep_d'].map(rep));

    for (const [id, color] of after) {
      expect(before.get(id)).toBe(color);
    }
  });

  it('does not depend on the order the roster arrives in', () => {
    const forwards = repColors(['rep_a', 'rep_b', 'rep_c'].map(rep));
    const backwards = repColors(['rep_c', 'rep_b', 'rep_a'].map(rep));
    expect([...backwards]).toEqual(expect.arrayContaining([...forwards]));
  });

  it('gives every rep a distinct colour up to the size of the palette', () => {
    const ids = Array.from({ length: REP_PALETTE.length }, (_, i) => rep(`rep_${i}`));
    const colors = [...repColors(ids).values()];
    expect(new Set(colors).size).toBe(REP_PALETTE.length);
  });

  it('still gives every rep a colour past the palette rather than none', () => {
    // Collisions are unavoidable here. Handing somebody undefined is not, and
    // an undefined colour is a door that renders with no tack at all.
    const ids = Array.from({ length: REP_PALETTE.length * 2 + 3 }, (_, i) => rep(`rep_${i}`));
    const colors = repColors(ids);
    expect(colors.size).toBe(ids.length);
    for (const id of ids) {
      expect(REP_PALETTE).toContain(colors.get(id.id));
    }
  });

  it('has no colour twice in the palette', () => {
    expect(new Set(REP_PALETTE).size).toBe(REP_PALETTE.length);
  });
});

describe('lastRepByProperty', () => {
  it('takes the latest knock by its clock, not by array order', () => {
    // Offline uploads arrive in whatever order signal allowed.
    const map = lastRepByProperty([
      { propertyId: 'p1', repId: 'rep_late', occurredAt: '2026-08-10T17:00:00.000Z' },
      { propertyId: 'p1', repId: 'rep_early', occurredAt: '2026-08-01T17:00:00.000Z' },
    ]);
    expect(map.get('p1')).toBe('rep_late');
  });

  it('leaves a door with no knocks out entirely', () => {
    // Absence is what leaves it grey. A default rep would be the map claiming
    // somebody worked a door nobody has been to.
    const map = lastRepByProperty([]);
    expect(map.has('p1')).toBe(false);
  });
});
