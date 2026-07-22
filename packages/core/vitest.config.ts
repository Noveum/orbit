import { defineConfig } from 'vitest/config';

const LOCAL_TEST_DATABASE_URL = 'postgres://orbit:orbit@localhost:5434/orbit_test_core';

function resolveTestDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  const ambient = process.env['DATABASE_URL'];
  const candidate =
    explicit ?? (ambient?.includes('test') === true ? ambient : LOCAL_TEST_DATABASE_URL);
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
    env: {
      DATABASE_URL: resolveTestDatabaseUrl(),
      REDIS_URL: '',
    },
  },
});
