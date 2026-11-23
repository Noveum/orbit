import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

export const POSTGRES_18_IMAGE =
  'postgres:18-alpine@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71';
export const POSTGRES_19_IMAGE =
  'postgres:19-alpine@sha256:cac45fb483caee3668946088a1c0532db89d5285c28dbfeac889b4068296e06f';
export const UPGRADE_LOCK = '.orbit-upgrade.lock';
export const UPGRADE_STAGING = '.orbit-19-staging';

const DATA_ROOT = '/var/lib/postgresql';
const SOCKET_DIR = '/var/run/postgresql';
const DUMP_DIR = '/dump';
const UPGRADE_ROOT = '/upgrade';

type Database = { extensions: string[]; tables: Map<string, number> };
type Snapshot = { roles: string; databases: Map<string, Database> };

const rolesSchema = z.array(z.tuple([z.string(), z.string().nullable()]));
const namesSchema = z.array(z.string());
const tablesSchema = z.array(z.tuple([z.string(), z.string(), z.number().int().nonnegative()]));

class UpgradeError extends Error {}

function docker(
  args: string[],
  allowFailure = false,
): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const outcome = {
    code: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
  if (outcome.code !== 0 && !allowFailure) {
    throw new UpgradeError(`docker ${args.slice(0, 2).join(' ')} failed: ${outcome.stderr}`);
  }
  return outcome;
}

function onVolume(volume: string, script: string, allowFailure = false) {
  return docker(
    [
      'run',
      '--rm',
      '-v',
      `${volume}:${DATA_ROOT}`,
      '--entrypoint',
      'sh',
      POSTGRES_19_IMAGE,
      '-c',
      script,
    ],
    allowFailure,
  );
}

function holds(volume: string, major: number): boolean {
  return onVolume(volume, `test -s ${DATA_ROOT}/${major}/docker/PG_VERSION`, true).code === 0;
}

const CLEAR_EMPTY_19 = `rmdir ${DATA_ROOT}/19/docker ${DATA_ROOT}/19 2>/dev/null; test ! -e ${DATA_ROOT}/19`;

export function connection(database: string): string {
  return `dbname='${database.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

async function waitFor(check: () => boolean, what: string, seconds = 120): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((settle) => setTimeout(settle, 500));
  }
  throw new UpgradeError(`Timed out waiting for ${what}.`);
}

function query(container: string, user: string, database: string, sql: string): unknown {
  const output = docker([
    'exec',
    container,
    'psql',
    '-X',
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    user,
    '-d',
    connection(database),
    '-tA',
    '-c',
    sql,
  ]).stdout;
  return JSON.parse(output);
}

function snapshot(container: string, user: string): Snapshot {
  const roles = rolesSchema.parse(
    query(
      container,
      user,
      'postgres',
      "select coalesce(json_agg(json_build_array(rolname, rolpassword) order by rolname), '[]') from pg_authid where rolname !~ '^pg_'",
    ),
  );
  const names = namesSchema.parse(
    query(
      container,
      user,
      'postgres',
      'select json_agg(datname order by datname) from pg_database where not datistemplate',
    ),
  );
  const databases = new Map<string, Database>();
  for (const name of names) {
    const extensions = namesSchema.parse(
      query(
        container,
        user,
        name,
        "select coalesce(json_agg(extname order by extname), '[]') from pg_extension",
      ),
    );
    const counted = tablesSchema.parse(
      query(
        container,
        user,
        name,
        "select coalesce(json_agg(json_build_array(table_schema, table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint) order by table_schema, table_name), '[]') from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')",
      ),
    );
    const tables = new Map(
      counted.map(([schema, table, count]) => [`${schema}.${table}`, count] as const),
    );
    databases.set(name, { extensions, tables });
  }
  return { roles: JSON.stringify(roles), databases };
}

function databaseDifferences(name: string, expected: Database, actual: Database): string[] {
  const found: string[] = [];
  if (JSON.stringify(expected.extensions) !== JSON.stringify(actual.extensions))
    found.push(`extensions differ in ${name}`);
  for (const [table, count] of expected.tables) {
    const restored = actual.tables.get(table);
    if (restored !== count)
      found.push(`${name}: ${table} has ${restored ?? 'no'} rows, expected ${count}`);
  }
  for (const table of actual.tables.keys()) {
    if (!expected.tables.has(table)) found.push(`${name}: ${table} appeared during the restore`);
  }
  return found;
}

export function differences(before: Snapshot, after: Snapshot): string[] {
  const found: string[] = [];
  if (before.roles !== after.roles) found.push('roles or password hashes differ');
  for (const [name, expected] of before.databases) {
    const actual = after.databases.get(name);
    if (actual === undefined) found.push(`database ${name} is missing`);
    else found.push(...databaseDifferences(name, expected, actual));
  }
  for (const name of after.databases.keys()) {
    if (!before.databases.has(name)) found.push(`database ${name} appeared during the restore`);
  }
  return found;
}

function startServer(
  name: string,
  volume: string,
  socket: string,
  image: string,
  mountPoint: string,
  env: string[] = [],
): void {
  docker([
    'run',
    '-d',
    '--name',
    name,
    '-v',
    `${volume}:${mountPoint}`,
    '-v',
    `${socket}:${SOCKET_DIR}`,
    ...env.flatMap((value) => ['-e', value]),
    image,
  ]);
}

function ready(container: string, user: string): boolean {
  return docker(['exec', container, 'pg_isready', '-q', '-U', user], true).code === 0;
}

function stop(container: string): void {
  docker(['stop', '-t', '60', container], true);
  docker(['rm', '-f', container], true);
}

async function prepareDumpDirectory(dumpDirectory: string): Promise<void> {
  await mkdir(dumpDirectory, { recursive: true, mode: 0o700 });
  await chmod(dumpDirectory, 0o700);
  if ((await readdir(dumpDirectory)).length > 0)
    throw new UpgradeError(`The dump directory ${dumpDirectory} must be empty.`);
}

export async function upgradeVolume(options: {
  volume: string;
  user: string;
  dumpDirectory: string;
  log: (line: string) => void;
}): Promise<'upgraded' | 'already-upgraded'> {
  const { volume, user, dumpDirectory, log } = options;
  docker(['volume', 'inspect', volume]);
  if (docker(['ps', '-q', '--filter', `volume=${volume}`]).stdout.length > 0)
    throw new UpgradeError(
      `Stop every container that uses ${volume} first, for example with docker compose stop.`,
    );
  if (holds(volume, 19)) {
    log(`${volume} already holds a PostgreSQL 19 cluster. Nothing to do.`);
    return 'already-upgraded';
  }
  if (!holds(volume, 18))
    throw new UpgradeError(
      `${volume} holds no PostgreSQL 18 cluster under ${DATA_ROOT}/18/docker.`,
    );

  if (onVolume(volume, `mkdir ${DATA_ROOT}/${UPGRADE_LOCK}`, true).code !== 0)
    throw new UpgradeError(
      `Another upgrade of ${volume} is running, or one was interrupted. If none is running, remove the lock with: docker run --rm -v ${volume}:${DATA_ROOT} --entrypoint rmdir ${POSTGRES_19_IMAGE} ${DATA_ROOT}/${UPGRADE_LOCK}`,
    );

  const id = randomUUID().slice(0, 8);
  const socket = `orbit-postgres-upgrade-${id}-socket`;
  const oldServer = `orbit-postgres-upgrade-${id}-18`;
  const newServer = `orbit-postgres-upgrade-${id}-19`;
  const owner =
    typeof process.getuid === 'function' && typeof process.getgid === 'function'
      ? ['--user', `${process.getuid()}:${process.getgid()}`]
      : [];
  const clientArgs = (args: string[]) => [
    'run',
    '--rm',
    ...owner,
    '-v',
    `${socket}:${SOCKET_DIR}`,
    '--mount',
    `type=bind,src=${dumpDirectory},dst=${DUMP_DIR}`,
    '--entrypoint',
    args[0] ?? '',
    POSTGRES_19_IMAGE,
    ...args.slice(1),
  ];
  const client = (args: string[]) => docker(clientArgs(args));
  let finished = false;

  try {
    if (onVolume(volume, CLEAR_EMPTY_19, true).code !== 0)
      throw new UpgradeError(
        `${volume} has a ${DATA_ROOT}/19 directory without a PostgreSQL 19 cluster in it. Move it aside before upgrading.`,
      );
    onVolume(volume, `rm -rf ${DATA_ROOT}/${UPGRADE_STAGING}`);
    await prepareDumpDirectory(dumpDirectory);
    docker(['volume', 'create', socket]);

    log('Starting the PostgreSQL 18 cluster.');
    startServer(oldServer, volume, socket, POSTGRES_18_IMAGE, DATA_ROOT);
    await waitFor(() => ready(oldServer, user), 'PostgreSQL 18 to accept connections');
    const before = snapshot(oldServer, user);
    const names = [...before.databases.keys()];

    log(`Dumping ${names.length} databases with the PostgreSQL 19 client into ${dumpDirectory}.`);
    client(['pg_dumpall', '-U', user, '--globals-only', '-f', `${DUMP_DIR}/globals.sql`]);
    for (const [index, name] of names.entries()) {
      client([
        'pg_dump',
        '-U',
        user,
        '-Fc',
        '-d',
        connection(name),
        '-f',
        `${DUMP_DIR}/database-${index}.dump`,
      ]);
    }
    stop(oldServer);

    log('Initializing PostgreSQL 19 in a staging directory on the same volume.');
    startServer(newServer, volume, socket, POSTGRES_19_IMAGE, UPGRADE_ROOT, [
      `PGDATA=${UPGRADE_ROOT}/${UPGRADE_STAGING}/docker`,
      `POSTGRES_USER=${user}`,
      `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`,
    ]);
    await waitFor(
      () => docker(['logs', newServer], true).stdout.includes('PostgreSQL init process complete'),
      'PostgreSQL 19 to initialize',
    );
    await waitFor(() => ready(newServer, user), 'PostgreSQL 19 to accept connections');

    log('Restoring roles and databases.');
    const globals = docker(
      clientArgs([
        'psql',
        '-X',
        '-q',
        '-U',
        user,
        '-d',
        'postgres',
        '-f',
        `${DUMP_DIR}/globals.sql`,
      ]),
      true,
    );
    const unexpected = globals.stderr
      .split('\n')
      .filter((line) => line.length > 0 && !line.includes(`role "${user}" already exists`));
    if (globals.code !== 0 || unexpected.length > 0)
      throw new UpgradeError(`Restoring roles failed: ${unexpected.join('\n')}`);
    const existing = new Set(
      namesSchema.parse(
        query(newServer, user, 'postgres', 'select json_agg(datname) from pg_database'),
      ),
    );
    for (const [index, name] of names.entries()) {
      const target = existing.has(name) ? ['-d', connection(name)] : ['-C', '-d', 'postgres'];
      client([
        'pg_restore',
        '-U',
        user,
        '--exit-on-error',
        ...target,
        `${DUMP_DIR}/database-${index}.dump`,
      ]);
    }

    log('Comparing the restored cluster with the original.');
    const found = differences(before, snapshot(newServer, user));
    if (found.length > 0)
      throw new UpgradeError(`The restored cluster does not match:\n${found.join('\n')}`);
    stop(newServer);
    if (
      onVolume(
        volume,
        `${CLEAR_EMPTY_19} && mv ${DATA_ROOT}/${UPGRADE_STAGING} ${DATA_ROOT}/19`,
        true,
      ).code !== 0
    )
      throw new UpgradeError(
        `${DATA_ROOT}/19 appeared during the upgrade, so the verified cluster was not moved into place.`,
      );
    finished = true;
    log(`Upgraded ${volume} to PostgreSQL 19. The dump stays in ${dumpDirectory}.`);
    log(`The PostgreSQL 18 files remain under ${DATA_ROOT}/18 in the volume for rollback.`);
    return 'upgraded';
  } finally {
    stop(oldServer);
    stop(newServer);
    if (!finished) onVolume(volume, `rm -rf ${DATA_ROOT}/${UPGRADE_STAGING}`, true);
    onVolume(volume, `rmdir ${DATA_ROOT}/${UPGRADE_LOCK}`, true);
    docker(['volume', 'rm', '-f', socket], true);
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      volume: { type: 'string' },
      user: { type: 'string', default: 'orbit' },
      'dump-dir': { type: 'string' },
    },
  });
  if (values.volume === undefined) {
    process.stderr.write(
      'Usage: bun run postgres:upgrade-volume --volume <docker volume> [--user orbit] [--dump-dir <empty directory>]\n',
    );
    process.exit(2);
  }
  const dumpDirectory = resolve(
    values['dump-dir'] ?? join(tmpdir(), `orbit-postgres-19-upgrade-${Date.now()}`),
  );
  try {
    await upgradeVolume({
      volume: values.volume,
      user: values.user,
      dumpDirectory,
      log: (line) => process.stdout.write(`${line}\n`),
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
