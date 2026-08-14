// QA item 12. A throw inside one module view must not take the platform
// down with it, and must not follow you to the next view either.

import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter, Link, Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Explodes(): never {
  throw new Error('module view blew up');
}

function Fine() {
  return <p>a working view</p>;
}

// React logs the caught error itself, which is correct behaviour and noise
// in the report. Silenced for these tests only.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// A two-route fixture, not the platform's route table, so there is no
// builder in @/types/routes to use here and nothing for one to protect.
const WORKING_VIEW = '/ok';

describe('ErrorBoundary', () => {
  it('shows a way forward instead of a blank page', () => {
    render(
      <ErrorBoundary>
        <Explodes />
      </ErrorBoundary>
    );

    expect(screen.getByText('This section could not be displayed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('retries the render rather than reloading the page', async () => {
    const user = userEvent.setup();

    // Throws once, then renders. A transient failure has to be recoverable
    // without losing the rest of the session.
    function FlakyHost() {
      const [broken, setBroken] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setBroken(false)}>
            repair
          </button>
          <ErrorBoundary>{broken ? <Explodes /> : <Fine />}</ErrorBoundary>
        </>
      );
    }

    render(<FlakyHost />);
    expect(screen.getByText('This section could not be displayed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'repair' }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('a working view')).toBeInTheDocument();
  });

  it('does not follow you to the next view', async () => {
    // The boundary lives in the shell, above the outlet, so it survives
    // navigation. Without a reset it keeps showing the failure of a view you
    // have already left, and the app looks broken everywhere.
    const user = userEvent.setup();

    function Shell() {
      const { pathname } = useLocation();
      return (
        <div>
          <Link to={WORKING_VIEW}>go to the working view</Link>
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      );
    }

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <Shell />,
          children: [
            { index: true, element: <Explodes /> },
            { path: 'ok', element: <Fine /> },
          ],
        },
      ],
      { initialEntries: ['/'] }
    );

    render(<RouterProvider router={router} />);
    expect(screen.getByText('This section could not be displayed')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'go to the working view' }));

    expect(screen.getByText('a working view')).toBeInTheDocument();
  });
});
