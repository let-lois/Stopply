import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Builds the preview in preview/ into one JS file and one CSS file, which
// scripts/build-preview.mjs then inlines into a single self contained page.
// Separate from vite.config.ts on purpose: nothing here is ever part of a
// build that reaches a store.

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  root: 'preview',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../preview-dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    // One file each, so the page can inline them without resolving a chunk
    // graph. Spread rather than written inline because Vite 8 honours
    // codeSplitting but has not added it to BuildEnvironmentOptions yet.
    ...({ codeSplitting: false } as { codeSplitting: boolean }),
    rollupOptions: {
      output: {
        // A classic script rather than a module: the page writes this into
        // an iframe document, and a module would be deferred past the point
        // the surrounding page is looking for it.
        format: 'iife',
        entryFileNames: 'preview.js',
        assetFileNames: 'preview[extname]',
      },
    },
  },
});
