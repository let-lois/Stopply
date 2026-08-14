// Modal dialog, built on the native <dialog> element.
//
// The prototype hand-rolled this and got the interaction wrong in a way that
// looked right: the inner panel called stopPropagation, but the backdrop had
// no click handler at all, so the stopPropagation guarded nothing and clicking
// outside never dismissed. Missing entirely were Escape, focus containment,
// focus restore, background scroll lock, and any dialog semantics.
//
// showModal() provides most of that natively: focus moves in, focus is trapped,
// Escape fires `cancel`, the background goes inert, and the browser restores
// focus to the trigger on close. What it does not do is lock body scroll or
// treat a backdrop click as a dismiss, so both are handled here.

import { useCallback, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Dialog({ open, onClose, title, description, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  // showModal makes the background inert but leaves it scrollable behind the
  // dialog, which on a long page reads as the dialog sliding away.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Escape fires `cancel`, not `close`. Intercepting it here keeps React state
  // as the single source of truth for whether the dialog is open.
  const handleCancel = useCallback(
    (event: React.SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onClose();
    },
    [onClose]
  );

  // The backdrop is part of the dialog element's own box, so a click that
  // lands on the element itself rather than on the panel inside it is a
  // backdrop click.
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDialogElement>) => {
      if (event.target === ref.current) onClose();
    },
    [onClose]
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleCancel}
      onClick={handleClick}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] bg-transparent p-0 text-[var(--color-ink)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {/* Rendered only while open so the contents remount each time. Dialog
          state surviving across opens is what let the prototype's create-client
          form keep the previous client's module selection. */}
      {open && (
        <div className="glass-panel animate-fadeIn flex max-h-[85dvh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-[var(--color-hairline)] p-6">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-[var(--color-ink-soft)]">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-full p-2 text-[var(--color-ink-faint)] transition-colors hover:bg-fill-subtle hover:text-[var(--color-ink)]"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="overflow-y-auto p-6">{children}</div>

          {footer && (
            <footer className="flex justify-end gap-3 border-t border-[var(--color-hairline)] p-6">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
