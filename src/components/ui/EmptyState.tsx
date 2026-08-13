import type { LucideIcon } from 'lucide-react';

// An empty state is an invitation to act, not an apology. Where a capability
// genuinely does not exist yet it says so plainly and offers nothing that
// would pretend otherwise.
export interface EmptyStateProps {
  Icon?: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}

export function EmptyState({ Icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="glass-panel flex flex-col items-center gap-3 p-10 text-center">
      {Icon && <Icon size={28} className="text-[var(--color-ink-faint)]" aria-hidden="true" />}
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-[var(--color-ink-soft)]">{body}</p>
      {action}
    </div>
  );
}
