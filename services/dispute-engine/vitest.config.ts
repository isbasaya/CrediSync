import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 90_000,
    include: ['src/**/*.test.ts'],
    // Workspace packages are loaded natively from dist, so one copy of stateful modules
    // (the storage provider) is shared between the test and the code under test.
    server: { deps: { external: [/packages[\/][^\/]+[\/]dist[\/]/] } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
