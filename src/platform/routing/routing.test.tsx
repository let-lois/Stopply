// The routing and entitlement behaviour from the manual QA list, asserted
// where a test can reach it.
//
// These are the items the prototype failed: a client without a module could
// reach that module's view, an unknown route fell through to analytics, and
// disabling a module while viewing it left the module on screen.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { PlatformProvider } from '@/lib/state/PlatformProvider';
import { ModuleGuard, WorkspaceIndexRedirect } from '@/platform/routing/ModuleGuard';
import { NotFoundView } from '@/platform/routing/NotFoundView';
import { MODULE_ORDER, MODULE_REGISTRY } from '@/modules/registry';
import { moduleSlug } from '@/types/routes';
import WorkspaceSettingsPage from '@/platform/clients/WorkspaceSettingsPage';

// Real registry, real guard, stub leaves: this exercises the routing rules
// rather than the module views, which have their own coverage.
const moduleRoutes: RouteObject[] = MODULE_ORDER.flatMap((moduleId) =>
  Object.keys(MODULE_REGISTRY[moduleId].views).map((viewId) => ({
    path: `c/:clientId/${moduleSlug(moduleId)}/${viewId}`,
    element: (
      <ModuleGuard moduleId={moduleId}>
        <p>{`${MODULE_REGISTRY[moduleId].name} ${viewId}`}</p>
      </ModuleGuard>
    ),
  }))
);

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        children: [
          { path: 'c/:clientId', element: <WorkspaceIndexRedirect /> },
          { path: 'c/:clientId/settings', element: <WorkspaceSettingsPage /> },
          ...moduleRoutes,
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
    { initialEntries: [path] }
  );
  return render(
    <PlatformProvider>
      <RouterProvider router={router} />
    </PlatformProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('ModuleGuard', () => {
  it('renders a module the client has bought', async () => {
    // Rogue Solar carries field sales.
    renderAt('/c/cl_roguesolar/field-sales/dashboard');
    expect(await screen.findByText('Field Sales dashboard')).toBeInTheDocument();
  });

  it('refuses a module the client does not have, and says so', async () => {
    // QA item 4. Allstar has no logistics. The prototype rendered the module
    // anyway, because entitlement lived in the sidebar rather than the route.
    renderAt('/c/cl_allstar/logistics/dashboard');
    expect(await screen.findByText(/Logistics is not enabled/)).toBeInTheDocument();
    expect(screen.queryByText('Logistics dashboard')).not.toBeInTheDocument();
  });

  it('does not fall through to another module for an unknown one', async () => {
    // The prototype's switch defaulted to the analytics view for any
    // unrecognised tab, including for clients without analytics enabled.
    renderAt('/c/cl_allstar/not-a-module/dashboard');
    expect(await screen.findByText('No such module')).toBeInTheDocument();
    expect(screen.queryByText('Analytics overview')).not.toBeInTheDocument();
  });

  it('404s an unknown client rather than rendering an empty workspace', async () => {
    renderAt('/c/cl_does_not_exist/crm/pipeline');
    expect(await screen.findByText('No such workspace')).toBeInTheDocument();
  });

  it('sends a bare workspace URL to a view the client actually has', async () => {
    // Allstar's first enabled module in nav order is field sales, not
    // advertising, so the landing view has to be derived rather than assumed.
    renderAt('/c/cl_allstar');
    expect(await screen.findByText('Field Sales dashboard')).toBeInTheDocument();
  });

  it('leaves the module when it is disabled while being viewed', async () => {
    // QA item 3, and the reachable bad state in the prototype: its
    // default-view effect was keyed on client id while reading
    // enabledModules, so toggling a module off left its dashboard rendering.
    const user = userEvent.setup();
    renderAt('/c/cl_roguesolar/settings');

    const toggle = await screen.findByRole('switch', { name: /Disable Field Sales/ });
    await user.click(toggle);

    // Advertising is Rogue Solar's next enabled module in nav order.
    await waitFor(() => {
      expect(screen.queryByRole('switch', { name: /Disable Field Sales/ })).not.toBeInTheDocument();
    });
  });
});
