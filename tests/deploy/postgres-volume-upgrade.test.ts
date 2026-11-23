import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  POSTGRES_18_IMAGE,
  POSTGRES_19_IMAGE,
  upgradeVolume,
} from '../../scripts/upgrade-postgres-volume.ts';

const id = crypto.randomUUID().slice(0, 8);
const volume = `orbit-postgres-upgrade-test-${id}`;
const original = `orbit-postgres-upgrade-test-${id}-18`;
const upgraded = `orbit-postgres-upgrade-test-${id}-19`;
const password = 'original-secret';
let dumpDirectory = '';

async function docker(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function sql(container: string, database: string, query: string): Promise<string> {
  const result = await docker(
    'exec',
    container,
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'orbit',
    '-d',
    database,
    '-tAc',
    query,
  );
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout;
}

async function waitReady(container: string, fresh: boolean): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const initialized =
      !fresh ||
      (await docker('logs', container)).stdout.includes('PostgreSQL init process complete');
    if (
      initialized &&
      (await docker('exec', container, 'pg_isready', '-q', '-U', 'orbit')).code === 0
    )
      return;
    await Bun.sleep(500);
  }
  throw new Error(`${container} did not accept connections.`);
}

const serviceSchema = z.object({ image: z.string() });
const definitionSchema = z.object({ services: z.object({ postgres: serviceSchema }) });
const zeaburSchema = z.object({
  spec: z.object({
    services: z.array(z.object({ name: z.string(), spec: z.object({ source: z.unknown() }) })),
  }),
});

async function postgresImages(): Promise<Record<string, string>> {
  const parse = async (path: string) => Bun.YAML.parse(await Bun.file(path).text());
  const compose = async (path: string) => {
    const service = definitionSchema.parse(await parse(path)).services.postgres;
    return service.image;
  };
  const zeaburPostgres = zeaburSchema
    .parse(await parse('deploy/catalogs/zeabur.yaml'))
    .spec.services.find((service) => service.name === 'postgres');
  if (zeaburPostgres === undefined) throw new Error('zeabur.yaml has no postgres service');
  const zeabur = serviceSchema.parse(zeaburPostgres.spec.source);
  return {
    'docker-compose.yml': await compose('docker-compose.yml'),
    'deploy/docker/compose.yaml': await compose('deploy/docker/compose.yaml'),
    'deploy/catalogs/compose.yaml': await compose('deploy/catalogs/compose.yaml'),
    'deploy/catalogs/zeabur.yaml': zeabur.image,
  };
}

beforeAll(async () => {
  dumpDirectory = await mkdtemp(join(tmpdir(), 'orbit-postgres-upgrade-test-'));
  expect((await docker('volume', 'create', volume)).code).toBe(0);
});

afterAll(async () => {
  await docker('rm', '-f', original, upgraded);
  await docker('volume', 'rm', '-f', volume);
  await rm(dumpDirectory, { recursive: true, force: true });
});

test('every Postgres definition runs the image the upgrade targets', async () => {
  const tag = POSTGRES_19_IMAGE.split('@')[0] ?? '';
  expect(await postgresImages()).toEqual({
    'docker-compose.yml': tag,
    'deploy/docker/compose.yaml': tag,
    'deploy/catalogs/compose.yaml': POSTGRES_19_IMAGE,
    'deploy/catalogs/zeabur.yaml': POSTGRES_19_IMAGE,
  });
});

test('upgrades a PostgreSQL 18 volume to 19 without losing data, roles or passwords', async () => {
  const env = [
    '-e',
    'POSTGRES_USER=orbit',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=orbit',
  ];
  expect(
    (
      await docker(
        'run',
        '-d',
        '--name',
        original,
        '-v',
        `${volume}:/var/lib/postgresql`,
        ...env,
        POSTGRES_18_IMAGE,
      )
    ).code,
  ).toBe(0);
  await waitReady(original, true);
  await sql(original, 'orbit', 'create extension pg_trgm');
  await sql(original, 'orbit', 'create table issue (id serial primary key, title text not null)');
  await sql(
    original,
    'orbit',
    "insert into issue (title) select 'Issue ' || n from generate_series(1, 500) n",
  );
  await sql(
    original,
    'orbit',
    'create index issue_title_trgm on issue using gin (title gin_trgm_ops)',
  );
  await sql(original, 'orbit', 'create database extra');
  await sql(original, 'extra', 'create table note (body text)');
  await sql(original, 'extra', "insert into note values ('kept')");
  await docker('stop', original);
  await docker('rm', original);

  const refused = await docker(
    'run',
    '--rm',
    '-v',
    `${volume}:/var/lib/postgresql`,
    ...env,
    POSTGRES_19_IMAGE,
  );
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain('/var/lib/postgresql/18/docker');

  const logged: string[] = [];
  const outcome = await upgradeVolume({
    volume,
    user: 'orbit',
    dumpDirectory,
    log: (line) => logged.push(line),
  });
  expect(outcome).toBe('upgraded');

  const started = await docker(
    'run',
    '-d',
    '--name',
    upgraded,
    '-v',
    `${volume}:/var/lib/postgresql`,
    '-e',
    'POSTGRES_USER=orbit',
    '-e',
    'POSTGRES_PASSWORD=ignored-after-init',
    '-e',
    'POSTGRES_DB=orbit',
    POSTGRES_19_IMAGE,
  );
  expect(started.code).toBe(0);
  await waitReady(upgraded, false);
  expect(Number(await sql(upgraded, 'orbit', 'show server_version_num'))).toBeGreaterThanOrEqual(
    190000,
  );
  expect(await sql(upgraded, 'orbit', 'select count(*) from issue')).toBe('500');
  expect(
    await sql(upgraded, 'orbit', "select count(*) from issue where title % 'Issue 42'"),
  ).not.toBe('0');
  expect(await sql(upgraded, 'orbit', "select nextval('issue_id_seq')")).toBe('501');
  expect(await sql(upgraded, 'extra', 'select body from note')).toBe('kept');

  const remote = (secret: string) =>
    docker(
      'exec',
      '-e',
      `PGPASSWORD=${secret}`,
      upgraded,
      'sh',
      '-c',
      'psql -X -h "$(hostname -i)" -U orbit -d orbit -tAc "select 1"',
    );
  expect((await remote(password)).stdout).toBe('1');
  expect((await remote('ignored-after-init')).code).not.toBe(0);

  await expect(
    upgradeVolume({ volume, user: 'orbit', dumpDirectory, log: (line) => logged.push(line) }),
  ).rejects.toThrow('Stop every container');
  await docker('stop', upgraded);
  expect(
    await upgradeVolume({ volume, user: 'orbit', dumpDirectory, log: (line) => logged.push(line) }),
  ).toBe('already-upgraded');
  expect(logged.at(-1)).toContain('already holds a PostgreSQL 19 cluster');
}, 600_000);
