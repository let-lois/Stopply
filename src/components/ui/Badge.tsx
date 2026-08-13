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
        solid ? `${a.solid} text-black/80` : `${a.soft} ${a.text} border ${a.border}`,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
