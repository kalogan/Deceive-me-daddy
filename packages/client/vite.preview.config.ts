import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Builds ONLY the backend-free preview harness as a standalone static site
// (PROJECT_BRIEF §8 — shareable URL). Same SOURCE-resolved shared types as the game
// build, but a single entry: preview.html emitted as the site's index.html so the share
// link opens straight onto the harness.
const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: fromHere('.'),
  base: './',
  resolve: {
    alias: {
      '@deceive/shared': fromHere('../shared/src/index.ts'),
      '@deceive/sim-core': fromHere('../sim-core/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist-preview',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: fromHere('preview.html') },
    },
  },
});
