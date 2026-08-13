// What a theme is, and how it gets onto the page.
//
// Deliberately free of React, because the first thing that has to happen is
// applying the stored theme *before* React exists. A page that paints dark and
// then flips to light a moment later is worse than one that was never themed:
// the flash is on every navigation, on every reload, and there is no amount of
// CSS that hides it once the decision is made in a component.
//
// So `main.tsx` calls applyTheme() at module scope, before render, and the
// provider only takes over afterwards.

export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The default, and it is dark rather than system on purpose.
 *
 * Dark is what this product looks like and what everyone using it already
 * sees. Defaulting to system would mean that the day this shipped, every user
 * on a light machine opened the tool to an application they did not recognise
 * and had not asked for. System is one click away for anyone who wants it.
 */
export const DEFAULT_THEME: Theme = 'dark';

export const THEME_STORAGE_KEY = 'stopply.theme';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** The stored choice, or the default. Never throws: storage can be blocked. */
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Private browsing, or a locked-down device. A theme is not worth failing
    // a page load over.
    return DEFAULT_THEME;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The choice still applies for this session; it just will not survive.
  }
}

/**
 * Which of the two palettes a setting actually resolves to right now.
 *
 * 'system' is not a palette, and everything that has to pick a colour in
 * JavaScript rather than in CSS, which is the map and the charts, needs the
 * resolved answer rather than the setting.
 */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Put the theme on the document.
 *
 * One attribute. Every colour in the application is a variable keyed off it,
 * so nothing else has to be told and no component re-renders to change colour.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  // The browser's own chrome, which the CSS cannot reach: form controls, the
  // scrollbar, and the colour behind the page during an overscroll bounce.
  document.documentElement.style.colorScheme = resolveTheme(theme);
}
