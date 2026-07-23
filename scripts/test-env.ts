const TEST_DATABASE_NAME = /^orbit_test(?:_[a-z0-9]+)*$/;

function databaseNameOf(candidate: string): string {
  return new URL(candidate).pathname.replace(/^\//, '');
}

function assertTestDatabase(name: string, source: string): string {
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(
      `Refusing to run tests against "${name}" from ${source}. The database name must match ${String(TEST_DATABASE_NAME)}, for example orbit_test_core.`,
    );
  }
  return name;
}

export function resolveTestDatabaseUrl(fallbackDatabase: string): string {
  assertTestDatabase(fallbackDatabase, 'the requested fallback database');
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit !== undefined && explicit.length > 0) {
    assertTestDatabase(databaseNameOf(explicit), 'TEST_DATABASE_URL');
    return explicit;
  }
  const ambient = process.env['DATABASE_URL'];
  if (ambient === undefined || ambient.length === 0) {
    return `postgres://orbit:orbit@localhost:5434/${fallbackDatabase}`;
  }
  if (TEST_DATABASE_NAME.test(databaseNameOf(ambient))) return ambient;
  const url = new URL(ambient);
  url.pathname = `/${fallbackDatabase}`;
  return url.toString();
}
