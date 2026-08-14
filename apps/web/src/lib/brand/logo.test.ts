// The logo rules, which the server and the picker both run.

import {
  checkLogo,
  LOGO_MAX_CHARS,
  MONOGRAM_COLORS,
  monogram,
  monogramColor,
} from '@/lib/brand/logo';

const png = (payload = 'iVBORw0KGgo=') => `data:image/png;base64,${payload}`;

describe('checkLogo', () => {
  it('accepts the raster types a logo comes as', () => {
    expect(checkLogo(png())).toBeNull();
    expect(checkLogo('data:image/jpeg;base64,/9j/4AA=')).toBeNull();
    expect(checkLogo('data:image/webp;base64,UklGRg==')).toBeNull();
  });

  it('refuses SVG', () => {
    // Deliberate. An SVG is a document that one workspace member uploads and
    // every other one renders, and the reason to allow it is convenience.
    expect(checkLogo('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')?.reason).toBe('type');
  });

  it('refuses anything that is not a data URI of an allowed image', () => {
    expect(checkLogo('https://example.invalid/logo.png')?.reason).toBe('type');
    expect(checkLogo('data:text/html;base64,PHNjcmlwdD4=')?.reason).toBe('type');
    expect(checkLogo('')?.reason).toBe('type');
  });

  it('refuses base64 with characters base64 does not have', () => {
    // The obvious way to smuggle something past a regex that only checks the
    // prefix is to put it after the comma.
    expect(checkLogo('data:image/png;base64,<script>')?.reason).toBe('type');
  });

  it('refuses an image over the ceiling before looking at its type', () => {
    const huge = png('A'.repeat(LOGO_MAX_CHARS));
    expect(checkLogo(huge)?.reason).toBe('size');
  });

  it('says what to do rather than that it failed', () => {
    // A user told "that did not work" learns nothing.
    expect(checkLogo('data:image/gif;base64,R0lGOD==')?.message).toMatch(/PNG, JPEG or WebP/);
    expect(checkLogo(png('A'.repeat(LOGO_MAX_CHARS)))?.message).toMatch(/too large/);
  });
});

describe('monogram', () => {
  it('takes the first letter of the first two words', () => {
    expect(monogram('Allstar Home Solutions')).toBe('AH');
    expect(monogram('Rogue Solar')).toBe('RS');
  });

  it('takes two letters from a single word', () => {
    expect(monogram('Stopply')).toBe('ST');
  });

  it('ignores punctuation rather than drawing it', () => {
    expect(monogram('  &  Blue Cactus')).toBe('BC');
    expect(monogram("O'Brien Roofing")).toBe('OR');
  });

  it('copes with a name that is only punctuation', () => {
    // A client cannot be created with an empty name, but the brand hook has a
    // moment before the roster arrives where the name is the empty string.
    expect(monogram('')).toBe('?');
    expect(monogram('---')).toBe('?');
  });

  it('handles a non-Latin name without dropping it', () => {
    expect(monogram('Ätna Bau')).toBe('ÄB');
  });
});

describe('monogramColor', () => {
  it('gives a workspace the same colour every time', () => {
    expect(monogramColor('cl_allstar')).toBe(monogramColor('cl_allstar'));
  });

  it('does not depend on any other workspace existing', () => {
    // Derived from the id, not from a position in a list, so onboarding a
    // client cannot recolour the ones already there.
    const before = monogramColor('cl_roguesolar');
    expect(monogramColor('cl_roguesolar')).toBe(before);
  });

  it('always returns a colour from the palette', () => {
    // Deliberately not "every workspace gets a different colour". A hash can
    // collide, and resolving that would make a workspace's colour depend on
    // who else exists, which is the property worth more. The initials are what
    // tell two workspaces apart.
    for (const id of ['cl_allstar', 'cl_roguesolar', 'cl_bluecactus', 'cl_beclinical', '']) {
      expect(MONOGRAM_COLORS).toContain(monogramColor(id));
    }
  });

  it('spreads a realistic roster across most of the palette', () => {
    // Not a guarantee, a smoke test: if a change to the hash sent every id to
    // one bucket this would catch it, and an occasional collision would not
    // trip it.
    const ids = Array.from({ length: 20 }, (_, i) => `cl_client${i}`);
    expect(new Set(ids.map(monogramColor)).size).toBeGreaterThan(6);
  });
});
