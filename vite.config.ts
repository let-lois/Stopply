import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// One alias definition, shared by the app build and the test runner, so a
// path that resolves in tests cannot fail in the bundle.
//
// @server exists so the Pages Functions can be unit tested by the same runner
// as the app. Wrangler resolves both from tsconfig paths when it bundles the
// Functions, so the two mappings have to agree; they are asserted against
// each other by the server tests simply importing through them.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@server': fileURLToPath(new URL('./server', import.meta.url)),
    },
  },
  build: {
    // `out`, not Vite's default `dist`. The Cloudflare Pages project that
    // serves this repository's production branch is configured in the
    // dashboard, not here, and its output directory is `out`. A build that
    // writes somewhere else succeeds and then publishes nothing, which reads
    // as a deploy that worked.
    outDir: 'out',
  },
  test: {
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // The app needs a DOM. The server explicitly must not have one: it runs
    // on workerd, and a test that passes because jsdom supplied a global the
    // Worker does not have is worse than no test.
    projects: [
      {
        extends: true,
        build: {
    // `out`, not Vite's default `dist`. The Cloudflare Pages project that
    // serves this repository's production branch is configured in the
    // dashboard, not here, and its output directory is `out`. A build that
    // writes somewhere else succeeds and then publishes nothing, which reads
    // as a deploy that worked.
    outDir: 'out',
  },
  test: {
          name: 'app',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          // The BI platform adapters are tested against a real server rather
          // than a stubbed fetch, because what is in question is whether this
          // app and that platform agree on the wire. This starts it.
          globalSetup: ['./qa/start-bi-fake.mjs'],
        },
      },
      {
        extends: true,
        build: {
    // `out`, not Vite's default `dist`. The Cloudflare Pages project that
    // serves this repository's production branch is configured in the
    // dashboard, not here, and its output directory is `out`. A build that
    // writes somewhere else succeeds and then publishes nothing, which reads
    // as a deploy that worked.
    outDir: 'out',
  },
  test: { name: 'server', environment: 'node', include: ['server/**/*.test.ts'] },
      },
    ],
  },
});
