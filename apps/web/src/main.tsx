import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { applyTheme, readStoredTheme } from '@/lib/theme/theme';
import { fixturesRequested, installFieldFixtures } from '@/platform/prototypes/fixtures';
import '@/index.css';

// The prototypes preview frames the rep app with its network replaced, so it
// can be looked at without a rep's password. Installed here, before anything
// renders, because the app asks who the rep is on its first paint and a later
// swap would let that first call reach the real server.
//
// Only ever when the URL asks for it by name, and it answers /api/field with
// invented data and nothing else. See platform/prototypes/fixtures.ts.
if (fixturesRequested(window.location.search)) installFieldFixtures();

// The theme goes on before the first paint, not from a component.
//
// This module is the entry the browser blocks on, so the attribute is set
// before anything renders. Doing it in an effect instead would paint the
// default first and correct it a frame later, which is a dark flash on every
// single load for anyone who chose light. There is nothing CSS can do about
// that once the decision lives in a component.
applyTheme(readStoredTheme());

// StrictMode double-invokes state updaters in development on purpose. That is
// a feature the prototype failed: it called an audit-logging side effect from
// inside a setState updater, so every module toggle wrote two entries in dev
// and one in production. Updaters here stay pure, so the two agree.
const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
