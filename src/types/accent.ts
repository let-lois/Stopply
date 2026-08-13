// Accent tokens, and the literal class strings each one maps to.
//
// The map exists because Tailwind extracts class names statically. A class
// built by interpolation, `bg-${accent}-500`, is never seen by the extractor
// and simply does not exist at runtime, with no error anywhere. Since the
// module registry assigns accents by token, every accent-driven style has to
// resolve through literals written out here.

export const ACCENT_TOKENS = [
  'slate',
  'indigo',
  'emerald',
  'amber',
  'rose',
  'sky',
  'purple',
] as const;

export type AccentToken = (typeof ACCENT_TOKENS)[number];

export interface AccentClasses {
  /** Solid fill, for a filled badge or an active nav marker. */
  solid: string;
  /** Low-opacity fill for a resting surface. */
  soft: string;
  /** Text in the accent. */
  text: string;
  /** Hairline border. */
  border: string;
  /** The glow this identity uses under emphasis surfaces. */
  glow: string;
}

export const ACCENT: Record<AccentToken, AccentClasses> = {
  slate: {
    solid: 'bg-[var(--color-accent-slate)]',
    soft: 'bg-[var(--color-accent-slate)]/12',
    text: 'text-[var(--color-accent-slate)]',
    border: 'border-[var(--color-accent-slate)]/40',
    glow: 'shadow-[0_0_32px_-8px_var(--color-accent-slate)]',
  },
  indigo: {
    solid: 'bg-[var(--color-accent-indigo)]',
    soft: 'bg-[var(--color-accent-indigo)]/12',
    text: 'text-[var(--color-accent-indigo)]',
    border: 'border-[var(--color-accent-indigo)]/40',
    glow: 'shadow-[0_0_32px_-8px_var(--color-accent-indigo)]',
  },
  emerald: {
    solid: 'bg-[var(--color-accent-emerald)]',
    soft: 'bg-[var(--color-accent-emerald)]/12',
    text: 'text-[var(--color-accent-emerald)]',
    border: 'border-[var(--color-accent-emerald)]/40',
    glow: 'shadow-[0_0_32px_-8px_var(--color-accent-emerald)]',
  },
  amber: {
    solid: 'bg-[var(--color-accent-amber)]',
    soft: 'bg-[var(--color-accent-amber)]/12',
    text: 'text-[var(--color-accent-amber)]',
    border: 'border-[var(--color-accent-amber)]/40',
    glow: 'shadow-[0_0_32px_-8px_var(--color-accent-amber)]',
  },
  rose: {
    solid: 'bg-[var(--color-accent-rose)]',
    soft: 'bg-[var(--color-accent-rose)]/12',
    text: 'text-[var(--color-accent-rose)]',
    border: 'border-[var(--color-accent-rose)]/40',
    glow: 'shadow-[0_0_32px_-8px_var(--color-accent-rose)]',
  },
  sky: {
    solid: 'bg-[var(--color-accent-sky)]',
    soft: 'bg-[var(--color-accent-sky)]/12',
    text: 'text-[var(--color-accent-sky)]',
    border: 'border-[var(--color-accent-sky)]/40',
    glow: 'shadow-[0_0_32px_-8px_var(--color-accent-sky)]',
  },
  purple: {
    solid: 'bg-[var(--color-accent-purple)]',
    soft: 'bg-[var(--color-accent-purple)]/12',
    text: 'text-[var(--color-accent-purple)]',
    border: 'border-[var(--color-accent-purple)]/40',
    glow: 'shadow-[0_0_32px_-8px_var(--color-accent-purple)]',
  },
};

// The record is total over AccentToken, so this is a lookup rather than a
// fallback. Kept as a function so call sites read the same as the registry.
export function accentClasses(token: AccentToken): AccentClasses {
  return ACCENT[token];
}
