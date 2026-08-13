import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--color-primary)] text-[var(--color-on-accent)] hover:brightness-110 disabled:brightness-75',
  secondary:
    'bg-fill text-[var(--color-ink)] hover:bg-fill-strong border border-[var(--color-hairline)]',
  ghost: 'text-[var(--color-ink-soft)] hover:bg-fill-subtle hover:text-[var(--color-ink)]',
  danger: 'bg-[var(--color-negative)] text-[var(--color-on-accent)] hover:brightness-110',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'secondary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      // Explicit, because a button inside a form defaults to submit and the
      // prototype had several that submitted by accident.
      type={rest.type ?? 'button'}
      {...rest}
      className={[
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        className,
      ].join(' ')}
    />
  );
}
