import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// One JS file and one CSS file, for inlining into a single page. Separate
// from vite.config.ts on purpose: nothing here is part of a build that ships.

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'artifact-dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    ...({ codeSplitting: false } as { codeSplitting: boolean }),
    rollupOptions: {
      input: fileURLToPath(new URL('./preview/artifact.tsx', import.meta.url)),
      output: {
        // A classic script: the page writes it into a document rather than
        // importing it, and a module would be deferred past that point.
        format: 'iife',
        entryFileNames: 'artifact.js',
        assetFileNames: 'artifact[extname]',
      },
    },
  },
});
