// The theme's rules, which are mostly about not losing a choice.

import {
  DEFAULT_THEME,
  applyTheme,
  isTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  THEME_STORAGE_KEY,
} from '@/lib/theme/theme';

function mockMatchMedia(prefersLight: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('light') ? prefersLight : !prefersLight,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readStoredTheme', () => {
  it('defaults to dark rather than to the machine', () => {
    // Defaulting to system would mean that on the day this shipped, every user
    // on a light machine opened the tool to an application they had not asked
    // for and did not recognise.
    expect(readStoredTheme()).toBe('dark');
    expect(DEFAULT_THEME).toBe('dark');
  });

  it('returns what was stored', () => {
    storeTheme('light');
    expect(readStoredTheme()).toBe('light');
  });

  it('ignores a value that is not a theme', () => {
    // Anyone can edit localStorage, and a junk value must not reach the
    // attribute and leave the page with no palette at all.
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readStoredTheme()).toBe('dark');
  });

  it('survives storage being unavailable', () => {
    // Private browsing and locked-down devices throw on access. A theme is not
    // worth failing a page load over.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readStoredTheme()).toBe('dark');
    getItem.mockRestore();
  });

  it('survives a write being refused', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => storeTheme('light')).not.toThrow();
    setItem.mockRestore();
  });
});

describe('isTheme', () => {
  it('accepts the three settings and nothing else', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('system')).toBe(true);
    expect(isTheme('Dark')).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('passes an explicit choice straight through', () => {
    // Even when the machine disagrees. This is the guard that makes an
    // explicit Dark stick on a laptop set to light.
    mockMatchMedia(true);
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('asks the machine only for system', () => {
    mockMatchMedia(true);
    expect(resolveTheme('system')).toBe('light');
    mockMatchMedia(false);
    expect(resolveTheme('system')).toBe('dark');
  });

  it('falls back to dark where there is nothing to ask', () => {
    // Older browsers, and any environment with no matchMedia at all.
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveTheme('system')).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('puts the setting on the document, not the resolved value', () => {
    // The CSS needs to tell "system" apart from "dark": one follows the media
    // query and one must not.
    mockMatchMedia(true);
    applyTheme('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('system');
  });

  it('sets color-scheme to the resolved value, not the setting', () => {
    // This one drives the browser's own chrome, which has no idea what
    // 'system' means and would ignore it.
    mockMatchMedia(true);
    applyTheme('system');
    expect(document.documentElement.style.colorScheme).toBe('light');

    applyTheme('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
