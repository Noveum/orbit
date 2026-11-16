import postgres from 'postgres';
import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';
import { ensureLaneDatabase } from './src/test-lane.ts';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const TEST_DATABASE = /^orbit_test_[a-z0-9]+(?:_[a-z0-9]+)*$/u;

function validateDatabaseUrl(candidate: string, source: string, requireTestName: boolean): URL {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Refusing database tests: ${source} must be a valid PostgreSQL URL.`);
  }
  if (!(['postgres:', 'postgresql:'].includes(url.protocol) && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error(
      `Refusing database tests: ${source} must point at a loopback PostgreSQL server.`,
    );
  }
  if (requireTestName && !TEST_DATABASE.test(url.pathname.slice(1))) {
    throw new Error(`Refusing database tests: ${source} must name an orbit_test_ database.`);
  }
  return url;
}

const ambient = process.env['DATABASE_URL'];
if (ambient !== undefined && ambient.length > 0) {
  validateDatabaseUrl(ambient, 'DATABASE_URL', false);
}
const explicit = process.env['TEST_DATABASE_URL'];
if (explicit !== undefined && explicit.length > 0) {
  validateDatabaseUrl(explicit, 'TEST_DATABASE_URL', true);
}
const databaseUrl = resolveTestDatabaseUrl('orbit_test_db');
const target = validateDatabaseUrl(databaseUrl, 'the resolved database', true);
await ensureLaneDatabase(databaseUrl, 'orbit_test_db');
const connection = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const [row] = await connection<{ name: string }[]>`select current_database() as name`;
  if (row?.name !== target.pathname.slice(1)) {
    throw new Error(
      'Refusing database tests: the connected database does not match the test target.',
    );
  }
} finally {
  await connection.end({ timeout: 5 });
}
process.env['DATABASE_URL'] = databaseUrl;
process.env['DATABASE_POOL_MAX'] = '2';
