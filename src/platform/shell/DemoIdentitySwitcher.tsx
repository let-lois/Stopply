// A presentation-layer demo device. NOT authentication, and not authorization.
//
// The name is chosen so it cannot be mistaken for either. Real authorization
// arrives in Phase 2 and is enforced server-side, from a session the browser
// cannot edit.
//
// The prototype booted every session as its first user (a super admin) and let
// anyone reassign their own role from a dropdown. Grepping every use of
// currentUser.role in that codebase found three: one rendered the role name,
// and two highlighted the active item in the dropdown itself. Zero
// authorization checks. Switching to representative changed one label while
// that user kept full access to every client, the credentials page, and the
// team page.
//
// It also mutated role while leaving clientId null, producing a client-scoped
// role with platform-wide scope: a user object no real backend could issue.
// Switching here changes both together, because a demo that models an
// impossible state teaches the wrong thing.

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { PlatformUser } from '@/types';
import { usePlatform, usePlatformActions } from '@/lib/state/PlatformProvider';

const ROLE_LABEL: Record<PlatformUser['role'], string> = {
  super_admin: 'Super admin',
  client_admin: 'Client admin',
  manager: 'Manager',
  representative: 'Representative',
};

export function DemoIdentitySwitcher({ currentUser }: { currentUser: PlatformUser }) {
  const { users } = usePlatform();
  const { setCurrentUser } = usePlatformActions();
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
        className="flex items-center gap-2 rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 py-2 text-left text-sm"
      >
        <span>
          <span className="block leading-tight">{currentUser.name}</span>
          <span className="micro-label">{ROLE_LABEL[currentUser.role]}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="glass-panel absolute right-0 z-50 mt-2 w-72 p-2"
        >
          <p className="px-3 py-2 text-xs text-[var(--color-ink-faint)]">
            Simulate an identity. This changes what the interface shows, not what
            anyone is allowed to do: there is no authorization in this build.
          </p>
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setCurrentUser(user);
                setOpen(false);
              }}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-white/8 ${
                user.id === currentUser.id ? 'bg-white/8' : ''
              }`}
            >
              <span className="block">{user.name}</span>
              <span className="text-xs text-[var(--color-ink-faint)]">
                {ROLE_LABEL[user.role]}
                {user.clientName ? ` · ${user.clientName}` : ' · platform wide'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
