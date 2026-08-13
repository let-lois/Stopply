// The theme, held once and readable anywhere.
//
// Two contexts rather than one, the same split the rest of the state uses: a
// component that only needs to *set* the theme, which is the toggle, must not
// re-render when the resolved theme changes, and a chart that only *reads* it
// must not re-render when the setter identity would otherwise churn.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  type Theme,
} from '@/lib/theme/theme';

export interface ThemeState {
  /** What the user picked: dark, light, or follow the machine. */
  theme: Theme;
  /** What that currently means. Never 'system'. */
  resolved: 'dark' | 'light';
}

const StateContext = createContext<ThemeState | undefined>(undefined);
const SetContext = createContext<((theme: Theme) => void) | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read from storage rather than from a constant, and read it during the
  // initial state so the first render already agrees with what main.tsx
  // painted. Starting from the default and correcting in an effect would make
  // the toggle show the wrong setting for one frame.
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => resolveTheme(readStoredTheme()));

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setResolved(resolveTheme(next));
    storeTheme(next);
    applyTheme(next);
  }, []);

  // Follow the machine while set to system.
  //
  // The listener is registered whatever the setting, and checks inside, so
  // that switching to system picks up the current preference immediately
  // rather than at the next time the user changes it in their OS.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: light)');

    const onChange = () => {
      if (theme !== 'system') return;
      // CSS has already switched by itself: the media query in index.css does
      // not need telling. This only keeps the resolved value, which the map
      // and the charts read, in step with it.
      setResolved(query.matches ? 'light' : 'dark');
      applyTheme('system');
    };

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const state = useMemo<ThemeState>(() => ({ theme, resolved }), [theme, resolved]);

  return (
    <StateContext.Provider value={state}>
      <SetContext.Provider value={setTheme}>{children}</SetContext.Provider>
    </StateContext.Provider>
  );
}

/**
 * The current theme.
 *
 * Falls back rather than throwing, unlike the other providers here. A chart
 * asking which palette it is on is not doing anything that should bring a page
 * down if it is rendered outside the provider, and dark is the default anyway.
 */
export function useTheme(): ThemeState {
  return useContext(StateContext) ?? { theme: 'dark', resolved: 'dark' };
}

export function useSetTheme(): (theme: Theme) => void {
  const value = useContext(SetContext);
  if (!value) throw new Error('useSetTheme must be used inside ThemeProvider');
  return value;
}
