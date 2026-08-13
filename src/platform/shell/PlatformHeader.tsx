import { Menu, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { routes } from '@/types/routes';
import { AccountMenu } from '@/platform/shell/AccountMenu';

export function PlatformHeader({
  navOpen,
  onToggleNav,
}: {
  navOpen: boolean;
  onToggleNav: () => void;
}) {
  const { currentUser } = usePlatform();

  return (
    <header className="flex h-(--spacing-header) items-center justify-between gap-4 border-b border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-6">
      <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onToggleNav}
        aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navOpen}
        className="rounded-xl p-2 text-[var(--color-ink-soft)] hover:bg-white/6 md:hidden"
      >
        {navOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
      <Link to={routes.clients()} className="flex min-w-0 items-center gap-3">
        {/* The real mark. Decorative here because the wordmark beside it
            already names the product, so announcing it twice is noise. */}
        <img src="/icon-192.png" alt="" width={36} height={36} className="size-9" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-tight">Stopply</span>
          {/* The strapline is the first thing worth losing on a narrow screen. */}
          <span className="micro-label hidden whitespace-nowrap sm:block">Operations platform</span>
        </span>
      </Link>
      </div>

      <div className="flex shrink-0 items-center gap-3">

        {currentUser && <AccountMenu currentUser={currentUser} />}
      </div>
    </header>
  );
}
