import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Internal packages resolve from SOURCE in tests (no build step needed), matching
// the tsconfig `paths`. Production bundling (Vite) is added with the client slice.
export default defineConfig({
  resolve: {
    alias: {
      '@deceive/shared': fromRoot('./packages/shared/src/index.ts'),
      '@deceive/sim-core': fromRoot('./packages/sim-core/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
