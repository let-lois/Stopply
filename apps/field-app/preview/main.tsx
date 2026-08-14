// The single page preview build.
//
// Mounts the real <FieldApp /> with the demo backend from
// @letlois/field-ui/demo, which replaces the network and nothing else. The
// test site at /field-preview runs the identical thing, so the two can never
// disagree about what the app looks like.
//
// Deliberately not part of the shipped app: `vite build` builds index.html,
// this has its own config and output directory, and nothing in src/ imports
// it.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FieldApp } from '@letlois/field-ui';
import { startFieldDemo } from '@letlois/field-ui/demo';
import '@letlois/field-ui/field.css';
import '../src/app.css';

startFieldDemo({ version: `${__APP_VERSION__} preview` });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FieldApp />
  </StrictMode>
);
