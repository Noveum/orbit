import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      DATABASE_URL:
        process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit_test_rt',
      REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6380',
    },
  },
});
