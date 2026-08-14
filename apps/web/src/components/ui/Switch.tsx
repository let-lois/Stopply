import { useId } from 'react';

// The one component the prototype got right. Ported, and the standard the
// rest of the kit is held to: real semantics, keyboard operable, disabled
// handled rather than merely styled.

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Hides the visible label while keeping it as the accessible name. */
  hideLabel?: boolean;
  disabled?: boolean;
  /** Explains why a disabled control is disabled. */
  hint?: string;
}

export function Switch({ checked, onChange, label, hideLabel, disabled, hint }: SwitchProps) {
  const labelId = useId();
  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        // The visible label is a sibling, so it has to be associated rather
        // than merely adjacent, or the control reaches assistive technology
        // unnamed.
        aria-label={hideLabel ? label : undefined}
        aria-labelledby={hideLabel ? undefined : labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-[var(--color-accent-indigo)]' : 'bg-fill-strong',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full transition-transform',
            // The knob was white, which is a knob you cannot see once it is
            // off and sitting on a pale track. It takes the colour that reads
            // on a filled accent when on, and the panel behind it when off, so
            // it is a disc in both positions and in both themes.
            checked
              ? 'bg-[var(--color-on-accent)]'
              : 'bg-[var(--color-surface-raised)] ring-1 ring-[var(--color-hairline)]',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
      {!hideLabel && (
        <span className="text-sm" id={labelId}>
          {label}
          {hint && <span className="block text-xs text-[var(--color-ink-faint)]">{hint}</span>}
        </span>
      )}
    </span>
  );
}
