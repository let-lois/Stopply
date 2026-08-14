import { AlertTriangle } from 'lucide-react';

// Errors say what happened and what to do about it.
export function ErrorState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="glass-panel flex flex-col items-center gap-3 border-[var(--color-caution)]/40 p-10 text-center">
      <AlertTriangle size={26} className="text-[var(--color-caution)]" aria-hidden="true" />
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-[var(--color-ink-soft)]">{body}</p>
      {action}
    </div>
  );
}
