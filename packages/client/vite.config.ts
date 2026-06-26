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
  },
});
