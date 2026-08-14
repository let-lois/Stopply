// The header, wearing whoever's brand this page belongs to.
//
// The mark and the name here are the most visible half of the white-label
// promise, and the easiest place to break it: this used to hardcode
// /icon-192.png and the word Stopply, which a client in their own workspace
// should never see.

import { Menu, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { routes } from '@/types/routes';
import { AccountMenu } from '@/platform/shell/AccountMenu';
import { BrandMark, ThemeToggle } from '@/components/ui';
import { useBrand } from '@/lib/brand/useBrand';

export function PlatformHeader({
  navOpen,
  onToggleNav,
}: {
  navOpen: boolean;
  onToggleNav: () => void;
}) {
  const { currentUser } = usePlatform();
  const brand = useBrand();

  // Where the mark leads. The client list is the agency's home and a
  // client-scoped user cannot open it, so for them it goes to their own
  // workspace instead of to a page that would 403.
  const home = currentUser?.clientId
    ? routes.workspaceIndex(currentUser.clientId)
    : routes.clients();

  return (
    <header className="flex h-(--spacing-header) items-center justify-between gap-4 border-b border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleNav}
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          className="rounded-xl p-2 text-[var(--color-ink-soft)] hover:bg-fill-subtle md:hidden"
        >
          {navOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
        <Link to={home} className="flex min-w-0 items-center gap-3">
          <BrandMark brand={brand} size={36} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight">
              {brand.name}
            </span>
            {/* Only the agency has one. "Operations platform" under a client's
                name would be telling them they are using somebody else's
                software, which is the thing being avoided. */}
            {brand.tagline && (
              <span className="micro-label hidden whitespace-nowrap sm:block">{brand.tagline}</span>
            )}
          </span>
        </Link>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* Hidden below sm, where the header has the workspace name, a nav
            button and an account menu competing for 390px. It is in the
            account menu on those screens instead, which is where a setting
            belongs anyway. */}
        <span className="hidden sm:inline-flex">
          <ThemeToggle />
        </span>
        {currentUser && <AccountMenu currentUser={currentUser} />}
      </div>
    </header>
  );
}
