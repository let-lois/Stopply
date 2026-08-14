import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const API_BASE = process.env.VITE_API_BASE ?? 'https://all-star.bi.letlois.com';

export default defineConfig({
  plugins: [
    react(),
    // The one host this app is allowed to talk to, written into the page's
    // CSP from the same value the API client uses, so the two cannot drift.
    {
      name: 'field-app-csp',
      transformIndexHtml(html: string) {
        return html.replace(/%API_BASE%/g, API_BASE);
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Capacitor copies this directory into both native projects.
    outDir: 'dist',
    emptyOutDir: true,
    // A rep may be installing this on a five year old work phone.
    target: ['es2020', 'safari14'],
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
