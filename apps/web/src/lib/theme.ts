// Light / dark mode preference. The choice is a user level setting kept in
// localStorage and reflected as a data-theme attribute on <html>, which the
// CSS variables in globals.css key off. White labeled tenants set their own
// theme vars inline on the app container, so their branding always wins over
// the dark palette.

export type ThemeMode = 'light' | 'dark';

const KEY = 'lbi-theme';

export function getThemeMode(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* ignore */
  }
  return 'light';
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
}

// Inlined into the document head so the correct theme is applied before the
// first paint, avoiding a flash of the light theme for dark mode users.
export const themeInitScript = `(function(){try{var m=localStorage.getItem('${KEY}');if(m==='dark'||m==='light'){document.documentElement.setAttribute('data-theme',m);}}catch(e){}})();`;
