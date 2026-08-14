// A card is a surface. When it is also the way you open something, it is a
// button and is rendered as one.
//
// The prototype put onClick on a plain <div> with no role, tabIndex, or key
// handler, so every clickable card was unreachable by keyboard. Making the
// interactive case a real <button> means focus, Enter, and Space all work
// without reimplementing any of them.

export interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return <div className={`glass-panel p-6 ${className}`}>{children}</div>;
}

export interface CardButtonProps extends CardProps {
  onClick: () => void;
  /** The action this card performs, for assistive technology. */
  label: string;
}

export function CardButton({ children, className = '', onClick, label }: CardButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`glass-panel w-full p-6 text-left transition hover:border-[var(--color-accent-indigo)]/50 ${className}`}
    >
      {children}
    </button>
  );
}
