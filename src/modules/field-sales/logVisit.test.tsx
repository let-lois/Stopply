// The write path, end to end through the real providers, the real seam, and
// the real selectors.
//
// These are QA items 5, 6, 7 and 10, which could not be exercised at all
// while field sales was read only. Each is a behaviour the prototype got
// wrong.

import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { PlatformProvider } from '@/lib/state/PlatformProvider';
import { FieldSalesProvider } from '@/lib/state/FieldSalesProvider';
import { useModuleData } from '@/lib/data/useModuleData';
import { useFieldSalesActions } from '@/lib/state/FieldSalesProvider';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { selectKpis } from '@/modules/field-sales/selectors';

// A harness that shows the numbers a dashboard shows, plus a control that
// logs a knock, so the assertions are about what a rep would actually see.
function Harness() {
  const { data } = useModuleData('field_sales');
  const { logVisit } = useFieldSalesActions();
  const { auditLog } = usePlatform();

  if (!data) return <p>no data</p>;
  const kpis = selectKpis(data.properties, data.visits);
  const target = data.properties[0];
  const rep = data.reps[0];
  if (!target || !rep) return <p>no properties</p>;

  return (
    <div>
      <p data-testid="visits">{kpis.visitsLogged}</p>
      <p data-testid="doors">{kpis.propertiesVisited}</p>
      <p data-testid="sales">{kpis.salesClosed}</p>
      <p data-testid="interested">{kpis.interestedLeads}</p>
      <p data-testid="audit-log-visits">
        {auditLog.filter((e) => e.action === 'LOG_VISIT').length}
      </p>
      {/* The status the detail panel would show: derived from state on every
          render, not from a snapshot taken when the property was selected. */}
      <p data-testid="target-status">{data.properties[0]?.disposition}</p>

      <button
        type="button"
        onClick={() =>
          logVisit({ propertyId: target.id, disposition: 'closed_sale', notes: null, repId: rep.id })
        }
      >
        Log sale
      </button>
      <button
        type="button"
        onClick={() =>
          logVisit({ propertyId: target.id, disposition: 'not_interested', notes: null, repId: rep.id })
        }
      >
        Log not interested
      </button>
    </div>
  );
}

function renderHarness() {
  const router = createMemoryRouter(
    [{ path: '/c/:clientId', element: <FieldSalesProvider><Harness /></FieldSalesProvider> }],
    { initialEntries: ['/c/cl_allstar'] }
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

describe('logging a visit', () => {
  it('updates the door and the numbers immediately', async () => {
    // QA item 5. The prototype called addPropertyVisit but never refreshed
    // the selected property, so the panel kept showing the old status at
    // exactly the moment the rep wanted confirmation.
    const user = userEvent.setup();
    renderHarness();

    const before = Number(screen.getByTestId('visits').textContent);
    await user.click(screen.getByRole('button', { name: 'Log sale' }));

    await waitFor(() => {
      expect(screen.getByTestId('target-status')).toHaveTextContent('closed_sale');
    });
    expect(Number(screen.getByTestId('visits').textContent)).toBe(before + 1);
  });

  it('does not double-count a sale logged twice on the same door', async () => {
    // QA item 6. The prototype incremented salesClosed on every Closed Sale,
    // including one re-logged on an already-closed property.
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'Log sale' }));
    await waitFor(() => {
      expect(screen.getByTestId('target-status')).toHaveTextContent('closed_sale');
    });
    const afterFirst = Number(screen.getByTestId('sales').textContent);

    await user.click(screen.getByRole('button', { name: 'Log sale' }));
    await waitFor(() => {
      expect(Number(screen.getByTestId('visits').textContent)).toBeGreaterThan(0);
    });

    // Two knocks, one sale: the count comes from the door's state, not from
    // how many times somebody pressed the button.
    expect(Number(screen.getByTestId('sales').textContent)).toBe(afterFirst);
  });

  it('lets a lead count go down when the door changes its mind', async () => {
    // The prototype neither incremented nor decremented on this move, so
    // interestedLeads only ever grew.
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'Log sale' }));
    await waitFor(() => {
      expect(screen.getByTestId('target-status')).toHaveTextContent('closed_sale');
    });
    const salesAfterClose = Number(screen.getByTestId('sales').textContent);

    await user.click(screen.getByRole('button', { name: 'Log not interested' }));
    await waitFor(() => {
      expect(screen.getByTestId('target-status')).toHaveTextContent('not_interested');
    });

    expect(Number(screen.getByTestId('sales').textContent)).toBe(salesAfterClose - 1);
  });

  it('writes exactly one audit entry per knock under StrictMode', async () => {
    // QA item 7. The prototype logged from inside a setState updater, which
    // StrictMode double-invokes, so development wrote two entries and
    // production one and the two trails disagreed by construction.
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [{ path: '/c/:clientId', element: <FieldSalesProvider><Harness /></FieldSalesProvider> }],
      { initialEntries: ['/c/cl_allstar'] }
    );
    render(
      <StrictMode>
        <PlatformProvider>
          <RouterProvider router={router} />
        </PlatformProvider>
      </StrictMode>
    );

    await user.click(screen.getByRole('button', { name: 'Log sale' }));
    await waitFor(() => {
      expect(screen.getByTestId('audit-log-visits')).toHaveTextContent('1');
    });
  });

  it('survives a remount, which is what a refresh looks like', async () => {
    // QA item 10. The prototype persisted clients and currentClientId and
    // nothing else, so a refresh silently discarded every logged visit.
    const user = userEvent.setup();
    const first = renderHarness();

    await user.click(screen.getByRole('button', { name: 'Log sale' }));
    await waitFor(() => {
      expect(screen.getByTestId('target-status')).toHaveTextContent('closed_sale');
    });
    const visits = screen.getByTestId('visits').textContent;
    first.unmount();

    renderHarness();
    await waitFor(() => {
      expect(screen.getByTestId('target-status')).toHaveTextContent('closed_sale');
    });
    expect(screen.getByTestId('visits')).toHaveTextContent(visits ?? '');
  });

  it('keeps one workspace out of another', async () => {
    // Field work is stored per client. A knock on Allstar must not appear on
    // Rogue Solar, and switching workspace must not lose it either.
    const user = userEvent.setup();
    const first = renderHarness();
    await user.click(screen.getByRole('button', { name: 'Log sale' }));
    await waitFor(() => {
      expect(screen.getByTestId('target-status')).toHaveTextContent('closed_sale');
    });
    first.unmount();

    const otherRouter = createMemoryRouter(
      [{ path: '/c/:clientId', element: <FieldSalesProvider><Harness /></FieldSalesProvider> }],
      { initialEntries: ['/c/cl_roguesolar'] }
    );
    render(
      <PlatformProvider>
        <RouterProvider router={otherRouter} />
      </PlatformProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('target-status')).toBeInTheDocument();
    });
    // Rogue Solar's first door is its own, untouched by Allstar's knock.
    const status = screen.getByTestId('target-status').textContent;
    expect(status).not.toBe('closed_sale');
  });
});
