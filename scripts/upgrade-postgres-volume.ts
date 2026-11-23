import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export const POSTGRES_18_IMAGE =
  'postgres:18-alpine@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71';
export const POSTGRES_19_IMAGE =
  'postgres:19-alpine@sha256:cac45fb483caee3668946088a1c0532db89d5285c28dbfeac889b4068296e06f';

const DATA_ROOT = '/var/lib/postgresql';
const SOCKET_DIR = '/var/run/postgresql';
const DUMP_DIR = '/dump';
const UPGRADE_ROOT = '/upgrade';

type Snapshot = {
  roles: string[];
  databases: Record<string, { extensions: string[]; tables: Record<string, number> }>;
};

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

function layout(volume: string): { has18: boolean; has19: boolean } {
  const probe = (major: number) =>
    docker(
      [
        'run',
        '--rm',
        '-v',
        `${volume}:${DATA_ROOT}`,
        '--entrypoint',
        'test',
        POSTGRES_19_IMAGE,
        '-s',
        `${DATA_ROOT}/${major}/docker/PG_VERSION`,
      ],
      true,
    ).code === 0;
  return { has18: probe(18), has19: probe(19) };
}

function removeCluster(volume: string, major: number): void {
  docker([
    'run',
    '--rm',
    '-v',
    `${volume}:${DATA_ROOT}`,
    '--entrypoint',
    'rm',
    POSTGRES_19_IMAGE,
    '-rf',
    `${DATA_ROOT}/${major}`,
  ]);
}

async function waitFor(check: () => boolean, what: string, seconds = 120): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((settle) => setTimeout(settle, 500));
  }
  throw new UpgradeError(`Timed out waiting for ${what}.`);
}

function psql(container: string, user: string, database: string, sql: string): string {
  return docker([
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
    database,
    '-tA',
    '-c',
    sql,
  ]).stdout;
}

function lines(output: string): string[] {
  return output.split('\n').filter((line) => line.length > 0);
}

function snapshot(container: string, user: string): Snapshot {
  const roles = lines(
    psql(
      container,
      user,
      'postgres',
      "select rolname || ' ' || coalesce(rolpassword, '') from pg_authid where rolname !~ '^pg_' order by rolname",
    ),
  );
  const databases: Snapshot['databases'] = {};
  for (const database of lines(
    psql(
      container,
      user,
      'postgres',
      'select datname from pg_database where not datistemplate order by datname',
    ),
  )) {
    const extensions = lines(
      psql(container, user, database, 'select extname from pg_extension order by extname'),
    );
    const counting = lines(
      psql(
        container,
        user,
        database,
        "select format('select %L || '' '' || count(*) from %I.%I', table_schema || '.' || table_name, table_schema, table_name) from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1",
      ),
    );
    const tables: Record<string, number> = {};
    for (const query of counting) {
      const [name, count] = psql(container, user, database, query).split(' ');
      if (name === undefined || count === undefined)
        throw new UpgradeError(`Could not count ${query}.`);
      tables[name] = Number(count);
    }
    databases[database] = { extensions, tables };
  }
  return { roles, databases };
}

function differences(before: Snapshot, after: Snapshot): string[] {
  const found: string[] = [];
  if (JSON.stringify(before.roles) !== JSON.stringify(after.roles))
    found.push('roles or password hashes differ');
  for (const [name, expected] of Object.entries(before.databases)) {
    const actual = after.databases[name];
    if (actual === undefined) {
      found.push(`database ${name} is missing`);
      continue;
    }
    if (JSON.stringify(expected.extensions) !== JSON.stringify(actual.extensions))
      found.push(`extensions differ in ${name}`);
    for (const [table, count] of Object.entries(expected.tables)) {
      if (actual.tables[table] !== count)
        found.push(`${name}.${table} has ${actual.tables[table] ?? 'no'} rows, expected ${count}`);
    }
    for (const table of Object.keys(actual.tables)) {
      if (!(table in expected.tables)) found.push(`${name}.${table} appeared during the restore`);
    }
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

export async function upgradeVolume(options: {
  volume: string;
  user: string;
  dumpDirectory: string;
  log: (line: string) => void;
}): Promise<'upgraded' | 'already-upgraded'> {
  const { volume, user, dumpDirectory, log } = options;
  docker(['volume', 'inspect', volume]);
  const users = docker(['ps', '-q', '--filter', `volume=${volume}`]).stdout;
  if (users.length > 0)
    throw new UpgradeError(
      `Stop every container that uses ${volume} first, for example with docker compose stop.`,
    );

  const state = layout(volume);
  if (state.has19) {
    log(`${volume} already holds a PostgreSQL 19 cluster. Nothing to do.`);
    return 'already-upgraded';
  }
  if (!state.has18)
    throw new UpgradeError(
      `${volume} holds no PostgreSQL 18 cluster under ${DATA_ROOT}/18/docker.`,
    );

  await mkdir(dumpDirectory, { recursive: true });
  if ((await readdir(dumpDirectory)).length > 0)
    throw new UpgradeError(`The dump directory ${dumpDirectory} must be empty.`);

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
  let created19 = false;
  let finished = false;

  docker(['volume', 'create', socket]);
  try {
    log('Starting the PostgreSQL 18 cluster.');
    startServer(oldServer, volume, socket, POSTGRES_18_IMAGE, DATA_ROOT);
    await waitFor(() => ready(oldServer, user), 'PostgreSQL 18 to accept connections');
    const before = snapshot(oldServer, user);

    log(
      `Dumping ${Object.keys(before.databases).length} databases with the PostgreSQL 19 client into ${dumpDirectory}.`,
    );
    client(['pg_dumpall', '-U', user, '--globals-only', '-f', `${DUMP_DIR}/globals.sql`]);
    for (const database of Object.keys(before.databases)) {
      client(['pg_dump', '-U', user, '-Fc', '-d', database, '-f', `${DUMP_DIR}/${database}.dump`]);
    }
    stop(oldServer);

    log('Initializing PostgreSQL 19 on the same volume.');
    created19 = true;
    startServer(newServer, volume, socket, POSTGRES_19_IMAGE, UPGRADE_ROOT, [
      `PGDATA=${UPGRADE_ROOT}/19/docker`,
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
    const unexpected = lines(globals.stderr).filter(
      (line) => !line.includes(`role "${user}" already exists`),
    );
    if (globals.code !== 0 || unexpected.length > 0)
      throw new UpgradeError(`Restoring roles failed: ${unexpected.join('\n')}`);
    const existing = new Set(
      lines(psql(newServer, user, 'postgres', 'select datname from pg_database')),
    );
    for (const database of Object.keys(before.databases)) {
      const target = existing.has(database) ? ['-d', database] : ['-C', '-d', 'postgres'];
      client([
        'pg_restore',
        '-U',
        user,
        '--exit-on-error',
        ...target,
        `${DUMP_DIR}/${database}.dump`,
      ]);
    }

    log('Comparing the restored cluster with the original.');
    const found = differences(before, snapshot(newServer, user));
    if (found.length > 0)
      throw new UpgradeError(`The restored cluster does not match:\n${found.join('\n')}`);
    stop(newServer);
    finished = true;
    log(`Upgraded ${volume} to PostgreSQL 19. The dump stays in ${dumpDirectory}.`);
    log(`The PostgreSQL 18 files remain under ${DATA_ROOT}/18 in the volume for rollback.`);
    return 'upgraded';
  } finally {
    stop(oldServer);
    stop(newServer);
    if (created19 && !finished) removeCluster(volume, 19);
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
