import { defineConfig } from 'vitest/config';

const LOCAL_TEST_DATABASE_URL = 'postgres://orbit:orbit@localhost:5434/orbit_test_mcp';

function resolveTestDatabaseUrl(): string {
  const candidate =
    process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? LOCAL_TEST_DATABASE_URL;
  const name = new URL(candidate).pathname.replace(/^\//, '');
  if (!name.includes('test')) {
    throw new Error(
      `Refusing to run tests against "${name}". Point TEST_DATABASE_URL at a database whose name contains "test".`,
    );
  }
  return candidate;
}

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: resolveTestDatabaseUrl(),
      REDIS_URL: '',
    },
  },
});
