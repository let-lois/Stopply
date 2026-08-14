// The signed-in account, and the way out.
//
// This replaces DemoIdentitySwitcher, which was a presentation device and
// said so: it let anyone pick their own role from a dropdown, changing one
// label while that user kept full access to every client, the credentials
// page and the team page. Grepping the prototype for currentUser.role found
// three uses, all cosmetic, and zero authorization checks.
//
// There is nothing to switch to now. The name and role shown here come from
// the session the server resolved, the browser cannot edit them, and signing
// out deletes the session row rather than merely clearing a cookie.

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { LogOut } from 'lucide-react';
import type { PlatformUser } from '@/types';
import { useSessionActions } from '@/lib/auth/SessionProvider';
import { ThemeToggle } from '@/components/ui';

const ROLE_LABEL: Record<PlatformUser['role'], string> = {
  super_admin: 'Super admin',
  client_admin: 'Client admin',
  manager: 'Manager',
  representative: 'Representative',
};

export function AccountMenu({ currentUser }: { currentUser: PlatformUser }) {
  const { signOut } = useSessionActions();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Outside click and Escape. The prototype's two header dropdowns had
  // neither, and could both be open at once.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        className="flex items-center gap-2 rounded-xl border border-[var(--color-hairline)] bg-fill-subtle px-3 py-2 text-left text-sm"
      >
        <span>
          <span className="block leading-tight">{currentUser.name}</span>
          <span className="micro-label">{ROLE_LABEL[currentUser.role]}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {open && (
        <div id={menuId} role="menu" className="glass-panel absolute right-0 z-50 mt-2 w-64 p-2">
          <div className="px-3 py-2">
            <p className="text-sm">{currentUser.email}</p>
            <p className="text-xs text-[var(--color-ink-faint)]">
              {ROLE_LABEL[currentUser.role]}
              {currentUser.clientName ? ` · ${currentUser.clientName}` : ' · platform wide'}
            </p>
          </div>
          {/* Only where the header has no room for it, so the control is
              never on screen twice at once with two sets of checked states to
              keep in step. */}
          <div className="border-t border-[var(--color-hairline)] px-3 py-3 sm:hidden">
            <p className="micro-label mb-2">Theme</p>
            <ThemeToggle size="touch" />
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-fill"
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
