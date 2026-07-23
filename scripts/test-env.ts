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

export function resolveTestDatabaseUrl(fallbackDatabase: string): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit !== undefined && explicit.length > 0) {
    return assertTestDatabase(explicit, 'TEST_DATABASE_URL');
  }
  const ambient = process.env['DATABASE_URL'];
  if (ambient === undefined || ambient.length === 0) {
    return `postgres://orbit:orbit@localhost:5434/${fallbackDatabase}`;
  }
  if (databaseNameOf(ambient).includes('test')) return ambient;
  const url = new URL(ambient);
  url.pathname = `/${fallbackDatabase}`;
  return url.toString();
}
