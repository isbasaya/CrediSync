import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 90_000,
    env: {
      NODE_ENV: 'test',
      BUREAU_MODE: 'sandbox',
      OPEN_BANKING_MODE: 'sandbox',
    },
  },
});
