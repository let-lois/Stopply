// Navigation, derived entirely from the registry and the client's
// entitlements. No module's name, icon, colour or route is written here.

import { NavLink, useParams } from 'react-router-dom';
import { FileClock, KeyRound, Settings, Users2, Building2 } from 'lucide-react';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { MODULE_ORDER, MODULE_REGISTRY } from '@/modules/registry';
import { routes } from '@/types/routes';
import { accentClasses } from '@/types/accent';

const PLATFORM_LINKS = [
  { to: routes.clients(), label: 'Clients', Icon: Building2 },
  { to: routes.team(), label: 'Team', Icon: Users2 },
  { to: routes.audit(), label: 'Activity', Icon: FileClock },
  { to: routes.credentials(), label: 'Credentials', Icon: KeyRound },
  { to: routes.settings(), label: 'Settings', Icon: Settings },
];

function linkClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
    isActive
      ? 'bg-white/10 text-[var(--color-ink)] font-medium'
      : 'text-[var(--color-ink-soft)] hover:bg-white/6 hover:text-[var(--color-ink)]',
  ].join(' ');
}

export function PlatformSidebar({
  open,
  onNavigate,
}: {
  /** Drawer state. Ignored at and above the medium breakpoint. */
  open: boolean;
  onNavigate: () => void;
}) {
  const { clientId } = useParams<{ clientId: string }>();
  const { clients } = usePlatform();
  const client = clients.find((c) => c.id === clientId);

  return (
    <aside
      // Fixed overlay on a phone, a real grid column from md up. Hidden
      // rather than merely off screen when closed, so its links are not
      // reachable by tab from behind the backdrop.
      className={[
        'z-40 min-h-0 w-64 overflow-y-auto border-r border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-4',
        'fixed inset-y-0 left-0 top-(--spacing-header) md:static md:w-auto md:bg-[var(--color-surface-raised)]/60',
        open ? 'block' : 'hidden md:block',
      ].join(' ')}
    >
      <nav className="flex flex-col gap-1">
        <p className="micro-label px-3 pb-2">Platform</p>
        {PLATFORM_LINKS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={linkClass} onClick={onNavigate}>
            <Icon size={16} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      {client && (
        <nav className="mt-6 flex flex-col gap-1">
          <p className="micro-label px-3 pb-2">{client.name}</p>

          {/* Only what this client has. The sidebar not drawing a button is a
              presentation decision; ModuleGuard is what actually refuses. */}
          {MODULE_ORDER.filter((id) => client.enabledModules.includes(id)).map((id) => {
            const def = MODULE_REGISTRY[id];
            return (
              <div key={id} className="flex flex-col gap-0.5">
                <NavLink
                  to={routes.workspace(client.id, id, def.defaultView)}
                  className={linkClass}
                  onClick={onNavigate}
                  end={false}
                >
                  <def.Icon size={16} className={accentClasses(def.accent).text} aria-hidden="true" />
                  {def.name}
                </NavLink>
                <div className="ml-9 flex flex-col gap-0.5">
                  {Object.entries(def.views)
                    .filter(([, view]) => view.showInNav)
                    .map(([viewId, view]) => (
                      <NavLink
                        key={viewId}
                        to={routes.workspace(client.id, id, viewId)}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          [
                            'rounded-lg px-3 py-1.5 text-xs transition',
                            isActive
                              ? 'text-[var(--color-ink)] font-medium'
                              : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)]',
                          ].join(' ')
                        }
                      >
                        {view.label}
                      </NavLink>
                    ))}
                </div>
              </div>
            );
          })}

          <NavLink to={routes.workspaceSettings(client.id)} className={linkClass} onClick={onNavigate}>
            <Settings size={16} aria-hidden="true" />
            Workspace settings
          </NavLink>
        </nav>
      )}
    </aside>
  );
}
