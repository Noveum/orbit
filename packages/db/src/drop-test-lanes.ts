import postgres from 'postgres';

const LANE_DATABASE = /^orbit_test_[a-z0-9]+_[a-z0-9]+$/;
const BASE_DATABASES = new Set([
  'orbit_test_core',
  'orbit_test_svc',
  'orbit_test_rt',
  'orbit_test_rts',
  'orbit_test_mcp',
  'orbit_test_web',
]);

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';

const admin = postgres(
  (() => {
    const parsed = new URL(connectionString);
    parsed.pathname = '/postgres';
    return parsed.toString();
  })(),
  { max: 1, idle_timeout: 5 },
);

try {
  const rows = await admin<{ datname: string }[]>`
    select datname from pg_database where datname like 'orbit_test%' order by datname`;

  let dropped = 0;
  for (const row of rows) {
    const name = row.datname;
    if (BASE_DATABASES.has(name) || !LANE_DATABASE.test(name)) continue;
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    console.log(`dropped ${name}`);
    dropped += 1;
  }

  console.log(dropped === 0 ? 'No lane databases to drop.' : `Dropped ${dropped} lane databases.`);
} finally {
  await admin.end();
}
