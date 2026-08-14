// One scroll model, and only one.
//
// The prototype had three competing systems: min-h-screen flex on the layout,
// a sticky h-20 header, an overflow-hidden wrapper, a sticky sidebar with its
// own calc height, and a main with another. position: sticky needs a
// *scrolling ancestor*; the sidebar's only scroll container was `main`, its
// sibling, so `sticky top-20` did nothing at all. The header sat outside the
// scroll container, so its `sticky top-0` was equally inert. Neither looked
// broken, which is why both survived.
//
// Here the page is a grid that owns the viewport. The header is a real row.
// The sidebar and main are each genuine scroll containers, so nothing needs
// to be sticky and no height is calculated by hand.
//
// Below the medium breakpoint the sidebar becomes an overlay drawer rather
// than a grid column. Left in the flow it stacked above the content, so a
// phone had to scroll past the entire navigation to reach the page.

import { Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PlatformHeader } from '@/platform/shell/PlatformHeader';
import { PlatformSidebar } from '@/platform/shell/PlatformSidebar';
import { Skeleton } from '@/components/ui';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WorkspaceBanner } from '@/platform/shell/WorkspaceBanner';
import { FieldSalesProvider } from '@/lib/state/FieldSalesProvider';
import { useBrand } from '@/lib/brand/useBrand';
import { useDocumentBrand } from '@/lib/brand/useDocumentBrand';

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  // The tab, which is as much a part of "a client never sees Stopply" as the
  // header is. Done at the shell rather than per view, so a page added later
  // cannot forget.
  useDocumentBrand(useBrand());

  // The drawer closes from the click that navigates, not from an effect
  // watching the URL. Closing it is a consequence of the interaction, and
  // reacting to the location instead means a synchronous setState in an
  // effect, which cascades a render on every navigation.

  // Escape dismisses it, the same as every other dismissible surface here.
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  const closeNav = useCallback(() => setNavOpen(false), []);

  return (
    // Inside the router, so the provider can read the active client from the
    // route rather than from a second source of truth beside it.
    <FieldSalesProvider>
      <div className="grid h-dvh grid-rows-[auto_1fr] overflow-hidden">
        <PlatformHeader navOpen={navOpen} onToggleNav={() => setNavOpen((v) => !v)} />

        <div className="relative grid min-h-0 grid-cols-1 md:grid-cols-[16rem_1fr]">
          <PlatformSidebar open={navOpen} onNavigate={closeNav} />

          {navOpen && (
            <button
              type="button"
              aria-label="Close navigation"
              onClick={closeNav}
              className="fixed inset-0 z-30 bg-black/60 md:hidden"
            />
          )}

          <main className="min-w-0 overflow-y-auto">
            <WorkspaceBanner />
            <div className="p-4 sm:p-6">
              {/* One broken view must not leave the shell wedged after
                  navigating away, which is what keying it on the path buys. */}
              <ErrorBoundary resetKey={pathname}>
                <Suspense fallback={<Skeleton className="h-64" />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </FieldSalesProvider>
  );
}
