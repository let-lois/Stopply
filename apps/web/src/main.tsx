import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { applyTheme, readStoredTheme } from '@/lib/theme/theme';
import '@/index.css';

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
