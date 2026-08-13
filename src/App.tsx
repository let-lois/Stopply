// Router and providers. Nothing else.
//
// Workspace child routes are generated from the registry, not written by
// hand, so a module's views and its URLs cannot disagree.

import { Suspense, lazy } from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { PlatformProvider } from '@/lib/state/PlatformProvider';
import { SessionProvider } from '@/lib/auth/SessionProvider';
import { RequireSession } from '@/platform/auth/RequireSession';
import { AppShell } from '@/platform/shell/AppShell';
import { ModuleGuard, WorkspaceIndexRedirect } from '@/platform/routing/ModuleGuard';
import { NotFoundView } from '@/platform/routing/NotFoundView';
import { MODULE_ORDER, MODULE_REGISTRY } from '@/modules/registry';
import { ROUTE_PATTERNS, moduleSlug, routes } from '@/types/routes';

const LoginPage = lazy(() => import('@/platform/auth/LoginPage'));
const ClientsPage = lazy(() => import('@/platform/clients/ClientsPage'));
const TeamPage = lazy(() => import('@/platform/team/TeamPage'));
const AuditLogPage = lazy(() => import('@/platform/audit/AuditLogPage'));
const CredentialsPage = lazy(() => import('@/platform/secrets/CredentialsPage'));
const PlatformSettingsPage = lazy(() => import('@/platform/settings/PlatformSettingsPage'));
const WorkspaceSettingsPage = lazy(() => import('@/platform/clients/WorkspaceSettingsPage'));

// One route per module view, built from the registry. Adding a view to a
// module gives it a URL with no router change.
const moduleRoutes: RouteObject[] = MODULE_ORDER.flatMap((moduleId) => {
  const def = MODULE_REGISTRY[moduleId];
  return Object.entries(def.views).map(([viewId, view]) => ({
    path: `c/:clientId/${moduleSlug(moduleId)}/${viewId}`,
    element: (
      <ModuleGuard moduleId={moduleId}>
        <view.Component />
      </ModuleGuard>
    ),
  }));
});

const router = createBrowserRouter([
  // Sign-in sits outside the shell. Drawing the nav and the workspace banner
  // around a login form would be claiming a session that does not exist.
  {
    path: ROUTE_PATTERNS.login,
    element: (
      <Suspense fallback={null}>
        <LoginPage />
      </Suspense>
    ),
  },

  // Everything else requires one. This decides what to draw, not what is
  // permitted: every API route resolves the session itself and answers 401
  // without one.
  {
    element: <RequireSession />,
    children: [
      {
        path: ROUTE_PATTERNS.root,
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to={routes.clients()} replace /> },
          { path: 'clients', element: <ClientsPage /> },
          { path: 'team', element: <TeamPage /> },
          { path: 'audit', element: <AuditLogPage /> },
          { path: 'credentials', element: <CredentialsPage /> },
          { path: 'settings', element: <PlatformSettingsPage /> },
          { path: 'c/:clientId', element: <WorkspaceIndexRedirect /> },
          { path: 'c/:clientId/settings', element: <WorkspaceSettingsPage /> },
          ...moduleRoutes,
          // An unknown module segment still reaches the guard, which 404s it
          // rather than falling through to another module's view.
          {
            path: 'c/:clientId/:moduleId/*',
            element: (
              <ModuleGuard>
                <NotFoundView />
              </ModuleGuard>
            ),
          },
          { path: '*', element: <NotFoundView /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    // Session outermost: what the platform may load depends on who is asking,
    // so there is nothing for PlatformProvider to fetch until that is known.
    <SessionProvider>
      <PlatformProvider>
        <RouterProvider router={router} />
      </PlatformProvider>
    </SessionProvider>
  );
}
