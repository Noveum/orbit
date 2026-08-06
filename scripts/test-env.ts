import { createHash } from 'node:crypto';

const TEST_DATABASE_NAME = /^orbit_test(?:_[a-z0-9]+)*$/;

const LANE_CHARACTERS = /[^a-z0-9]+/g;
const LANE_READABLE = 12;
const LANE_DIGEST = 8;

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

export function laneSuffix(raw: string | undefined): string {
  if (raw === undefined || raw.trim().length === 0) return '';
  const readable = raw.toLowerCase().replace(LANE_CHARACTERS, '').slice(0, LANE_READABLE);
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, LANE_DIGEST);
  return `${readable}${digest}`;
}

export function currentLane(): string {
  return laneSuffix(process.env['ORBIT_TEST_LANE']);
}

export function laneDatabase(base: string, lane: string): string {
  return lane.length === 0 ? base : `${base}_${lane}`;
}

export function resolveTestDatabaseUrl(fallbackDatabase: string): string {
  assertTestDatabase(fallbackDatabase, 'the requested fallback database');
  const lane = currentLane();
  const database = laneDatabase(fallbackDatabase, lane);
  assertTestDatabase(database, 'the resolved lane database');

  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit !== undefined && explicit.length > 0) {
    assertTestDatabase(databaseNameOf(explicit), 'TEST_DATABASE_URL');
    return explicit;
  }
  const ambient = process.env['DATABASE_URL'];
  if (ambient === undefined || ambient.length === 0) {
    return `postgres://orbit:orbit@localhost:5434/${database}`;
  }
  if (lane.length === 0 && TEST_DATABASE_NAME.test(databaseNameOf(ambient))) return ambient;
  const url = new URL(ambient);
  url.pathname = `/${database}`;
  return url.toString();
}
