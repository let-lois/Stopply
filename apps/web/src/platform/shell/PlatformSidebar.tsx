// Navigation, derived entirely from the registry and the client's
// entitlements. No module's name, icon, colour or route is written here.

import { NavLink, useParams } from 'react-router-dom';
import { FileClock, KeyRound, Settings, Users2, Building2, Smartphone } from 'lucide-react';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { useCan, type Permission } from '@/lib/auth/useCan';
import { MODULE_ORDER, MODULE_REGISTRY } from '@/modules/registry';
import { routes } from '@/types/routes';
import { accentClasses } from '@/types/accent';

// Each link carries the permission that makes it usable, so the nav and the
// server agree on who may go where.
//
// This used to show all five to everybody. The server refused the ones a
// client-scoped user could not use, so nothing leaked, but they were offered
// a "Clients" page listing every other client of the agency and got an error
// for their trouble. Under a white label that is worse than an error: it is a
// client being shown the shape of somebody else's business.
const PLATFORM_LINKS = [
  { to: routes.clients(), label: 'Clients', Icon: Building2, needs: 'client.viewAll' },
  { to: routes.team(), label: 'Team', Icon: Users2, needs: 'team.invite' },
  { to: routes.audit(), label: 'Activity', Icon: FileClock, needs: 'audit.view' },
  { to: routes.credentials(), label: 'Credentials', Icon: KeyRound, needs: 'credentials.view' },
  // The apps being built for clients, gated the same way Clients is: a
  // client-scoped user has no business seeing what is being built for
  // somebody else, or what is unfinished about it.
  { to: routes.prototypes(), label: 'Prototypes', Icon: Smartphone, needs: 'client.viewAll' },
  // Platform-wide configuration, which is the agency's own and not a
  // workspace's. A client has Workspace settings instead, further down.
  { to: routes.settings(), label: 'Settings', Icon: Settings, needs: 'client.viewAll' },
] as const satisfies ReadonlyArray<{
  to: string;
  label: string;
  Icon: typeof Building2;
  needs: Permission;
}>;

function linkClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
    isActive
      ? 'bg-fill text-[var(--color-ink)] font-medium'
      : 'text-[var(--color-ink-soft)] hover:bg-fill-subtle hover:text-[var(--color-ink)]',
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
  const { clients, currentUser } = usePlatform();
  const can = useCan();

  // A client-scoped user's own workspace, whichever page they are on, so their
  // modules are in the nav rather than appearing only once they have navigated
  // into a workspace route.
  const activeId = currentUser?.clientId ?? clientId;
  const client = clients.find((c) => c.id === activeId);

  const platformLinks = PLATFORM_LINKS.filter((link) => can(link.needs));

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
      {platformLinks.length > 0 && (
        <nav className="flex flex-col gap-1">
          {/* "Platform" is the agency's word for its own console. A client
              sees their own workspace name over their own section below, and
              this heading only where there is an agency to name. */}
          {can('client.viewAll') && <p className="micro-label px-3 pb-2">Platform</p>}
          {platformLinks.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} className={linkClass} onClick={onNavigate}>
              <Icon size={16} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      )}

      {client && (
        <nav
          className={[platformLinks.length > 0 ? 'mt-6' : '', 'flex flex-col gap-1'].join(' ')}
        >
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
