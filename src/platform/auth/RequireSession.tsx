// The gate.
//
// This is a UX affordance, exactly like ModuleGuard, and for the same reason:
// it decides what to draw, not what is permitted. Every API route resolves
// the session itself and answers 401 without one, so removing this component
// would make the app ugly rather than insecure.
//
// It matters anyway. Rendering a dashboard shell full of empty panels to a
// signed-out visitor, each panel showing its own error, is a worse answer
// than a sign-in page.

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '@/lib/auth/SessionProvider';
import { Skeleton } from '@/components/ui';
import { routes } from '@/types/routes';

export function RequireSession() {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'checking') {
    // The boot request is one round trip. Flashing the sign-in page during it
    // and then replacing it would tell an already-signed-in user they were
    // signed out.
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <Skeleton className="h-40 w-full max-w-sm" />
      </div>
    );
  }

  if (status === 'signed-out') {
    // Where they were going, so signing in returns them there rather than to
    // a generic landing page.
    return <Navigate to={routes.login()} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
