// The rep app.
//
// Written for a phone held in one hand, outdoors, in sun, by someone who is
// standing on a driveway rather than sitting at a desk. That is not a
// responsive version of the dashboard; it is a different set of decisions:
//
//  - Every target is at least 3.5rem tall. Apple and Google both say 44 to 48
//    pixels is the floor; a gloved thumb in February is not the case they
//    measured.
//  - Actions sit at the bottom, in the thumb's arc, not at the top under a
//    notch.
//  - Contrast is raised over the dashboard's. The same palette reads fine in
//    an office and washes out on a screen angled at the sky.
//  - Nothing depends on hover, and nothing depends on a second hand.
//  - h-dvh, not h-screen, because mobile browser chrome moves and a fixed
//    100vh puts the primary action under the address bar.

import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { FieldSessionProvider, useField } from '@/lib/field/FieldSessionProvider';

const FieldLogin = lazy(() => import('@/field/FieldLogin'));
const FieldToday = lazy(() => import('@/field/FieldToday'));

function FieldRoutes() {
  const { status } = useField();

  if (status === 'checking') {
    return (
      <div className="grid h-dvh place-items-center bg-[var(--color-surface-base)]">
        <p className="text-sm text-[var(--color-ink-soft)]">Loading your route…</p>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="h-dvh bg-[var(--color-surface-base)]" />}>
      <Routes>
        <Route
          path="/"
          element={status === 'signed-in' ? <FieldToday /> : <Navigate to="login" replace />}
        />
        <Route
          path="login"
          element={status === 'signed-in' ? <Navigate to=".." replace /> : <FieldLogin />}
        />
      </Routes>
    </Suspense>
  );
}

export default function FieldApp() {
  // Registered from here rather than from main.tsx, and scoped to /field, so
  // the dashboard is never controlled by it. A worker script at the root may
  // claim a narrower scope than its own path, which is what makes this legal.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/field-sw.js', { scope: '/field' }).catch((error: unknown) => {
      // Not fatal. Without the worker the app simply needs a connection to
      // open; the outbox, which is the part that protects a rep's knocks,
      // does not depend on it.
      console.warn('[field] offline support unavailable', error);
    });
  }, []);

  return (
    <FieldSessionProvider>
      {/* The safe-area padding is what keeps the sign-out control clear of a
          notch and the action bar clear of the home indicator. */}
      <div className="field-root min-h-dvh bg-[var(--color-surface-base)] text-[var(--color-ink)]">
        <FieldRoutes />
      </div>
    </FieldSessionProvider>
  );
}
