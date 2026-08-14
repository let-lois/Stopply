// Picking a theme.
//
// Three segments rather than a two-state switch. A switch can only say "light
// or dark", so choosing to follow the machine is not expressible on one, and
// the setting a user most often wants on a laptop that dims itself in the
// evening is exactly the one a switch cannot offer.
//
// A radiogroup rather than three buttons with aria-pressed. This is one choice
// with three answers, and that is what a radiogroup means; three toggles would
// announce as three independent on/off controls, one of which happens to be on.

import { Monitor, Moon, Sun } from 'lucide-react';
import { useSetTheme, useTheme } from '@/lib/theme/ThemeProvider';
import type { Theme } from '@/lib/theme/theme';

const OPTIONS: Array<{ id: Theme; label: string; Icon: typeof Sun }> = [
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
  { id: 'system', label: 'System', Icon: Monitor },
];

export interface ThemeToggleProps {
  /**
   * Bigger touch targets and visible labels, for the rep app.
   *
   * The dashboard version is icon-only and 36px, which is right next to an
   * account menu on a desktop and wrong under a thumb outdoors.
   */
  size?: 'compact' | 'touch';
}

export function ThemeToggle({ size = 'compact' }: ThemeToggleProps) {
  const { theme } = useTheme();
  const setTheme = useSetTheme();
  const touch = size === 'touch';

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={[
        'inline-flex rounded-xl border border-[var(--color-hairline)]',
        touch ? 'w-full gap-1 p-1' : 'gap-0.5 p-0.5',
      ].join(' ')}
    >
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            // The label is the accessible name in both sizes. The compact one
            // shows only an icon, and an icon-only control with no name is a
            // button that announces as "button".
            aria-label={label}
            title={label}
            onClick={() => setTheme(id)}
            className={[
              'flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
              touch ? 'min-h-12 flex-1 text-sm' : 'size-8',
              active
                ? 'bg-fill text-[var(--color-ink)]'
                : 'text-[var(--color-ink-faint)] hover:bg-fill-subtle hover:text-[var(--color-ink-soft)]',
            ].join(' ')}
          >
            <Icon size={touch ? 18 : 16} aria-hidden="true" />
            {touch && label}
          </button>
        );
      })}
    </div>
  );
}
