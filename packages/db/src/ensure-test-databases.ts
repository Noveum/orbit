import postgres from 'postgres';

const TEST_DATABASES = [
  'orbit_test_core',
  'orbit_test_svc',
  'orbit_test_rt',
  'orbit_test_rts',
  'orbit_test_mcp',
  'orbit_test_web',
] as const;

const DATABASE_NAME = /^orbit_test(?:_[a-z0-9]+)*$/;

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

function hostOf(url: string): { host: string; port: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, port: parsed.port === '' ? '5432' : parsed.port };
  } catch {
    throw new Error('DATABASE_URL is not a valid connection string.');
  }
}

function assertLocalServer(url: string): void {
  const { host, port } = hostOf(url);
  if (LOCAL_HOSTS.has(host)) return;
  if (process.env['ORBIT_ALLOW_REMOTE_TEST_SETUP'] === '1') return;
  throw new Error(
    `Refusing to create test databases on ${host}:${port}. This creates six databases and pushes the whole schema into each, which must never happen on a deployed server. Point DATABASE_URL at the local stack from bun run infra:up, or set ORBIT_ALLOW_REMOTE_TEST_SETUP=1 if you are certain.`,
  );
}

function isRemote(url: string): boolean {
  return !LOCAL_HOSTS.has(hostOf(url).host);
}

assertLocalServer(connectionString);

const remote = isRemote(connectionString);
const connectionOptions = remote ? { max: 1, ssl: 'verify-full' as const } : { max: 1 };

function adminUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

function databaseUrl(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const admin = postgres(adminUrl(connectionString), connectionOptions);

for (const name of TEST_DATABASES) {
  if (!DATABASE_NAME.test(name)) {
    throw new Error(`Refusing to create "${name}": it does not look like a test database.`);
  }
  const existing = await admin`select 1 from pg_database where datname = ${name}`;
  if (existing.length > 0) {
    console.log(`${name} already exists`);
    continue;
  }
  await admin.unsafe(`create database "${name}"`);
  console.log(`created ${name}`);
}

await admin.end();

for (const name of TEST_DATABASES) {
  const url = databaseUrl(connectionString, name);
  const sql = postgres(url, connectionOptions);
  await sql`create extension if not exists pg_trgm`;
  await sql.end();
}

console.log(`\n${TEST_DATABASES.length} test databases ready. Applying the schema to each.`);

for (const name of TEST_DATABASES) {
  const url = databaseUrl(connectionString, name);
  const push = Bun.spawn(['bunx', 'drizzle-kit', 'push', '--force'], {
    env: { ...process.env, DATABASE_URL: url },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await push.exited;
  if (code !== 0) {
    console.error(await new Response(push.stderr).text());
    throw new Error(`Could not push the schema to ${name}.`);
  }
  console.log(`schema applied to ${name}`);
}
