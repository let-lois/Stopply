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
        <span className="grid size-9 place-items-center rounded-xl bg-[var(--color-accent-indigo)] text-sm font-black text-white">
          S
        </span>
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
