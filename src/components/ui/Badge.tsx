import { accentClasses, type AccentToken } from '@/types/accent';

export interface BadgeProps {
  children: React.ReactNode;
  accent?: AccentToken;
  /** A filled badge reads as a state; the default outline reads as a label. */
  solid?: boolean;
}

export function Badge({ children, accent = 'slate', solid = false }: BadgeProps) {
  const a = accentClasses(accent);
  return (
    <span
      className={[
        'micro-label inline-flex items-center rounded-full px-2.5 py-1',
        // A solid badge carries the ink that reads on a filled accent, which
        // is dark in the dark theme, where the accents are bright, and light
        // in the light theme, where they are not. It was a literal black.
        solid
          ? `${a.solid} text-[var(--color-on-accent-bright)]`
          : `${a.soft} ${a.text} border ${a.border}`,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
