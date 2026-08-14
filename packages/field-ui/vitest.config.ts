import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The outbox and the API client both talk to browser globals
    // (localStorage, fetch, window events), which is the point of them.
    environment: 'happy-dom',
  },
});
