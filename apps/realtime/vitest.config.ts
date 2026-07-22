import { defineConfig } from 'vitest/config';

const LOCAL_TEST_DATABASE_URL = 'postgres://orbit:orbit@localhost:5434/orbit_test_rt';

function resolveTestDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit !== undefined) return explicit;
  const ambient = process.env['DATABASE_URL'];
  if (ambient === undefined) return LOCAL_TEST_DATABASE_URL;
  const url = new URL(ambient);
  if (url.pathname.replace(/^\//, '').includes('test')) return ambient;
  url.pathname = '/orbit_test_rt';
  return url.toString();
}

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      DATABASE_URL: resolveTestDatabaseUrl(),
      REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6380',
    },
  },
});
