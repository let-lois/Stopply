import { Link } from 'react-router-dom';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { routes } from '@/types/routes';
import { DemoIdentitySwitcher } from '@/platform/shell/DemoIdentitySwitcher';
import { Badge } from '@/components/ui';

export function PlatformHeader() {
  const { currentUser } = usePlatform();

  return (
    <header className="flex h-(--spacing-header) items-center justify-between gap-4 border-b border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-6">
      <Link to={routes.clients()} className="flex items-center gap-3">
        {/* The real mark. Decorative here because the wordmark beside it
            already names the product, so announcing it twice is noise. */}
        <img src="/icon-192.png" alt="" width={36} height={36} className="size-9" />
        <span>
          <span className="block text-sm font-semibold tracking-tight">Stopply</span>
          <span className="micro-label">Operations platform</span>
        </span>
      </Link>

      <div className="flex items-center gap-4">
        <Badge accent="amber">Demo data</Badge>
        <DemoIdentitySwitcher currentUser={currentUser} />
      </div>
    </header>
  );
}
