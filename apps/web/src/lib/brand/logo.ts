// What a client's mark is, and what stands in when they have not uploaded one.
//
// No React, so the server can share the validation. A logo the browser accepts
// and the server does not, or the other way round, is a workspace whose brand
// silently fails to save.

/**
 * What may be stored as a logo.
 *
 * Raster only. SVG is the obvious omission and it is deliberate: an SVG is a
 * document, it can carry script and external references, and it would be
 * uploaded by one workspace member and rendered for every other. Rendering it
 * only through <img> does defuse that in current browsers, but the reason to
 * allow it at all is convenience, and that is not worth reasoning about a
 * browser's script-blocking behaviour for. A PNG covers every real logo.
 */
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * The ceiling, in characters of data URI.
 *
 * Base64 costs about a third on top of the bytes, so this is roughly a 70KB
 * image: far more than a header logo needs and far under D1's 1MB row limit.
 * Checked on the server as well as in the picker, because the picker is a
 * convenience and the endpoint is the rule.
 */
export const LOGO_MAX_CHARS = 96 * 1024;

const DATA_URI = /^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export interface LogoProblem {
  reason: 'type' | 'size' | 'malformed';
  message: string;
}

/**
 * Whether a string is a logo this system will store.
 *
 * Returns the problem rather than a boolean so the same sentence can be shown
 * in the picker and returned by the API. A user who is told "that did not
 * work" learns nothing; a user told "PNG, JPEG or WebP" fixes it.
 */
export function checkLogo(value: string): LogoProblem | null {
  if (value.length > LOGO_MAX_CHARS) {
    return {
      reason: 'size',
      message: `That image is too large. Use one under ${Math.floor(LOGO_MAX_CHARS / 1024)}KB.`,
    };
  }
  if (!DATA_URI.test(value)) {
    // One message for a wrong type and for a mangled string, because the only
    // way to produce the latter is to bypass the picker, and a caller doing
    // that does not need help.
    return {
      reason: 'type',
      message: 'Use a PNG, JPEG or WebP image.',
    };
  }
  return null;
}

/**
 * The initials to draw when there is no uploaded mark.
 *
 * First letters of the first two words, so "Allstar Home Solutions" is AH and
 * "Rogue Solar" is RS. Deliberately not the client's `code`: the code is an
 * internal handle a client never chose and may not recognise as theirs.
 */
export function monogram(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Distinguishable marks for workspaces sitting next to each other in a list.
 *
 * Not the module accents: a module's colour means something, and reusing it
 * here would imply a client is somehow "the amber one".
 */
export const MONOGRAM_COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#059669',
  '#d97706',
  '#db2777',
  '#7c3aed',
  '#0891b2',
  '#c2410c',
  '#4f46e5',
  '#0284c7',
  '#047857',
  '#b45309',
  '#be123c',
  '#6d28d9',
] as const;

/**
 * A colour for a workspace, from its id.
 *
 * FNV-1a, so a workspace keeps its colour for as long as it keeps its id, and
 * onboarding a client cannot recolour the ones already there. Two workspaces
 * can land on the same colour, and that is accepted rather than resolved: the
 * fix would be to walk to the next free slot, which makes a colour depend on
 * who else exists, and that is the property worth more here. The initials are
 * what actually tell two workspaces apart; the colour is there to make a mark
 * out of them.
 */
export function monogramColor(clientId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < clientId.length; i++) {
    h ^= clientId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return MONOGRAM_COLORS[h % MONOGRAM_COLORS.length]!;
}
