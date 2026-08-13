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

import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { ModuleId } from '@/types';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { defaultViewFor, getModule } from '@/modules/registry';
import { moduleIdFromSlug, routes } from '@/types/routes';
import { NotFoundView } from '@/platform/routing/NotFoundView';
import { ModuleNotEnabledView } from '@/platform/routing/ModuleNotEnabledView';

export function ModuleGuard({
  children,
  moduleId: moduleIdProp,
}: {
  children: React.ReactNode;
  /**
   * The module this route serves.
   *
   * Passed in because routes generated from the registry carry the slug as a
   * *static* segment (`/c/:clientId/field-sales/dashboard`), so there is no
   * :moduleId param to read. Reading params alone made the guard 404 every
   * legitimate module view while still letting the catch-all through, which
   * is the worst possible split. The catch-all has no static segment, so it
   * still resolves from params.
   */
  moduleId?: ModuleId;
}) {
  const { clientId, moduleId: moduleSlugParam } = useParams<{
    clientId: string;
    moduleId: string;
  }>();
  const { clients } = usePlatform();
  const navigate = useNavigate();

  const client = clients.find((c) => c.id === clientId);
  const moduleId = moduleIdProp ?? (moduleSlugParam ? moduleIdFromSlug(moduleSlugParam) : undefined);
  const moduleDef = moduleId ? getModule(moduleId) : undefined;
  const isEnabled = !!client && !!moduleId && client.enabledModules.includes(moduleId);

  // Two different situations that must not be handled the same way.
  //
  // Arriving at a module the client never had is a link that does not apply:
  // it gets the explicit "not enabled" view, so whoever followed the link
  // learns why they did not arrive.
  //
  // A module switched off while you are looking at it is different. Leaving
  // you on a view that has just been revoked is the prototype's bug, so that
  // case redirects. Distinguishing them needs the memory of having been
  // enabled during this mount, which is what the ref holds.
  // Read and written only inside the effect: a ref touched during render is
  // not something React promises to keep consistent.
  const wasEnabled = useRef(isEnabled);

  useEffect(() => {
    if (isEnabled) {
      wasEnabled.current = true;
      return;
    }
    // Never had it. The explicit view stands, and nothing navigates.
    if (!wasEnabled.current || !client || !moduleId) return;

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
