import postgres from 'postgres';
import { databasesToDrop, laneDropTarget } from './test-lane-drop.ts';
import { databaseTlsOptions } from './tls-policy.ts';

const target = laneDropTarget(process.argv.slice(2), process.env['ORBIT_TEST_LANE']);

if (target.mode === 'refused') {
  console.error(target.reason);
  process.exit(1);
}

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';

const parsed = new URL(connectionString);
parsed.pathname = '/postgres';
const maintenanceUrl = parsed.toString();
const admin = postgres(maintenanceUrl, {
  max: 1,
  idle_timeout: 5,
  ...databaseTlsOptions(maintenanceUrl),
});

try {
  const rows = await admin<{ datname: string }[]>`
    select datname from pg_database where datname like 'orbit_test%' order by datname`;

  const doomed = databasesToDrop(
    target,
    rows.map((row) => row.datname),
  );

  for (const name of doomed) {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    console.log(`dropped ${name}`);
  }

  const scope = target.mode === 'all' ? 'every lane' : `lane ${target.lane}`;
  console.log(
    doomed.length === 0
      ? `No lane databases to drop for ${scope}.`
      : `Dropped ${doomed.length} lane databases for ${scope}.`,
  );
} finally {
  await admin.end();
}
