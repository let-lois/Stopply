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

import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { PlatformHeader } from '@/platform/shell/PlatformHeader';
import { PlatformSidebar } from '@/platform/shell/PlatformSidebar';
import { Skeleton } from '@/components/ui';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function AppShell() {
  return (
    <div className="grid h-dvh grid-rows-[auto_1fr] overflow-hidden">
      <PlatformHeader />
      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[16rem_1fr]">
        <PlatformSidebar />
        <main className="min-w-0 overflow-y-auto p-6">
          {/* Remounting the boundary per route means one broken view does not
              leave the whole shell wedged after navigating away. */}
          <ErrorBoundary>
            <Suspense fallback={<Skeleton className="h-64" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
