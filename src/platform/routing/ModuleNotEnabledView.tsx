import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { Client } from '@/types';
import { EmptyState } from '@/components/ui';
import { routes } from '@/types/routes';

// Shown instead of silently redirecting, so somebody who followed a link
// learns why they did not arrive. The prototype fell through to analytics for
// any unrecognised route, which meant four clients without analytics enabled
// could be shown it.
export function ModuleNotEnabledView({
  client,
  moduleName,
}: {
  client: Client;
  moduleName: string;
}) {
  return (
    <EmptyState
      Icon={Lock}
      title={`${moduleName} is not enabled for this workspace`}
      body={`${client.name} does not have ${moduleName} turned on. An administrator can enable it from the workspace settings.`}
      action={
        <Link
          to={routes.workspaceSettings(client.id)}
          className="rounded-xl bg-[var(--color-accent-indigo)] px-4 py-2 text-sm font-medium text-white"
        >
          Workspace settings
        </Link>
      }
    />
  );
}
