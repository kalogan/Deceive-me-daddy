import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Standard Vite config rooted at this package. Internal workspace packages resolve
// from SOURCE (matching the repo's tsconfig `paths` + the root vitest aliases) so the
// client always renders the REAL shared types — no forked "preview" data shapes
// (PROJECT_BRIEF §4.5).
const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: fromHere('.'),
  resolve: {
    alias: {
      '@deceive/shared': fromHere('../shared/src/index.ts'),
      '@deceive/sim-core': fromHere('../sim-core/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Emit BOTH entries: the game (index.html) and the backend-free preview harness
      // (preview.html). The harness shell + its DOM/CSS ride ONLY on preview.html, never
      // the game bundle (PROJECT_BRIEF §8).
      input: {
        index: fromHere('index.html'),
        preview: fromHere('preview.html'),
      },
    },
  },
});
