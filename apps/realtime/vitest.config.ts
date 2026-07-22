import { defineConfig } from 'vitest/config';

const LOCAL_TEST_DATABASE_URL = 'postgres://orbit:orbit@localhost:5434/orbit_test_rt';

function databaseNameOf(candidate: string): string {
  return new URL(candidate).pathname.replace(/^\//, '');
}

function assertTestDatabase(candidate: string, source: string): string {
  const name = databaseNameOf(candidate);
  if (!name.includes('test')) {
    throw new Error(
      `Refusing to run tests against "${name}" from ${source}. Point it at a database whose name contains "test".`,
    );
  }
  return candidate;
}

function resolveTestDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit !== undefined) return assertTestDatabase(explicit, 'TEST_DATABASE_URL');
  const ambient = process.env['DATABASE_URL'];
  if (ambient === undefined) return LOCAL_TEST_DATABASE_URL;
  if (databaseNameOf(ambient).includes('test')) return ambient;
  const url = new URL(ambient);
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
