import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import '@/index.css';

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
