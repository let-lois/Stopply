import type { DataMode } from '@/types';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { LiveModeNotAvailableError } from '@/lib/data/errors';

// The three states every view handles before it renders anything.
//
// The live case is the one that matters. A client switched to live mode sees
// this, not demo numbers behind a LIVE badge.
export function ModuleGate({
  isLoading,
  error,
  mode,
  hasData,
  children,
}: {
  isLoading: boolean;
  error: Error | null;
  mode: DataMode;
  hasData: boolean;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  if (error instanceof LiveModeNotAvailableError) {
    return (
      <ErrorState
        title="Live data is not connected yet"
        body="This workspace is set to live mode, but no live source has been connected for this module. Switch back to demo mode to explore the reporting, or connect a source once the backend is available."
      />
    );
  }

  if (error) {
    return <ErrorState title="That data could not be loaded" body={error.message} />;
  }

  if (!hasData) {
    return (
      <EmptyState
        title="Nothing to show yet"
        body={
          mode === 'demo'
            ? 'This workspace has no demo data for this module.'
            : 'No records have arrived for this module yet.'
        }
      />
    );
  }

  return <>{children}</>;
}
