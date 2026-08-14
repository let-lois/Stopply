import { accentClasses, type AccentToken } from '@/types/accent';

// The identity's numeric display: a quiet uppercase micro-label over a heavy
// tabular figure.
export interface StatProps {
  label: string;
  value: string;
  note?: string;
  accent?: AccentToken;
}

export function Stat({ label, value, note, accent = 'indigo' }: StatProps) {
  return (
    <div className="glass-panel p-5">
      <p className="micro-label">{label}</p>
      <p className={`numeric-display mt-2 text-3xl ${accentClasses(accent).text}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{note}</p>}
    </div>
  );
}
