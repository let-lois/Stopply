// Entitlement check for every workspace route.
//
// IMPORTANT: this is a UX affordance, not access control. It runs in the
// browser, on state the browser holds, and anyone can edit either. Phase 2
// must re-check enabledModules server-side on every module data request. A
// client-side check is advisory by definition.
//
// It exists because the prototype had none at all. renderMainContent()
// dispatched on activeTab alone; enabledModules appeared only inside a
// default-tab effect and never in the render switch. Module entitlement was
// enforced purely by the sidebar not drawing a button, which is presentation,
// on a product that sells modules at Pro and Enterprise prices per client.
//
// There was a reachable path to the wrong state without touching the URL: the
// default-tab effect was keyed on [currentClient?.id] while its body read
// currentClient.enabledModules, which was not in the deps. Open a client on
// advertising, toggle advertising off in the config dialog, and the sidebar
// section vanished while the ad dashboard kept rendering.

import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { defaultViewFor, getModule } from '@/modules/registry';
import { moduleIdFromSlug, routes } from '@/types/routes';
import { NotFoundView } from '@/platform/routing/NotFoundView';
import { ModuleNotEnabledView } from '@/platform/routing/ModuleNotEnabledView';

export function ModuleGuard({ children }: { children: React.ReactNode }) {
  const { clientId, moduleId: moduleSlugParam } = useParams<{
    clientId: string;
    moduleId: string;
  }>();
  const { clients } = usePlatform();
  const navigate = useNavigate();

  const client = clients.find((c) => c.id === clientId);
  const moduleId = moduleSlugParam ? moduleIdFromSlug(moduleSlugParam) : undefined;
  const moduleDef = moduleId ? getModule(moduleId) : undefined;
  const isEnabled = !!client && !!moduleId && client.enabledModules.includes(moduleId);

  // If the module is switched off while it is on screen, leave it. This is
  // the case the prototype could not see, because enabledModules was missing
  // from its effect's dependencies.
  useEffect(() => {
    if (!client || !moduleId || isEnabled) return;
    const fallback = defaultViewFor(client.enabledModules);
    if (fallback) {
      void navigate(routes.workspace(client.id, fallback.moduleId, fallback.viewId), {
        replace: true,
      });
    }
  }, [client, moduleId, isEnabled, navigate]);

  if (!client) {
    return <NotFoundView title="No such workspace" body="That client does not exist, or it has been removed." />;
  }

  // An unknown module segment is a 404. The prototype's switch fell through
  // to analytics for any unrecognised tab, so a typo rendered a module the
  // client might not even have.
  if (!moduleId || !moduleDef) {
    return <NotFoundView title="No such module" body="That part of the workspace does not exist." />;
  }

  if (!isEnabled) {
    // Explicit, not a silent redirect: somebody who followed a link deserves
    // to know why they did not arrive.
    return <ModuleNotEnabledView client={client} moduleName={moduleDef.name} />;
  }

  return <>{children}</>;
}

/** Sends a bare workspace URL to whichever view that client actually has. */
export function WorkspaceIndexRedirect() {
  const { clientId } = useParams<{ clientId: string }>();
  const { clients } = usePlatform();
  const client = clients.find((c) => c.id === clientId);

  if (!client) {
    return <NotFoundView title="No such workspace" body="That client does not exist, or it has been removed." />;
  }

  const fallback = defaultViewFor(client.enabledModules);
  if (!fallback) {
    return (
      <NotFoundView
        title="No modules enabled"
        body={`${client.name} has no modules turned on yet. Enable one from the workspace settings.`}
      />
    );
  }
  return <Navigate to={routes.workspace(client.id, fallback.moduleId, fallback.viewId)} replace />;
}
