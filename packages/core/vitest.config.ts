import { defineConfig } from 'vitest/config';

const testDatabaseUrl =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit_test_core';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      REDIS_URL: '',
    },
  },
});
