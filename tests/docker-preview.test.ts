import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { exportStandalone } from '../scripts/export-docker-preview';
import {
  ensureDockerPreviewScheduler,
  initializeDockerPreview,
} from '../scripts/init-docker-preview';
import { startDockerPreview } from '../scripts/start-docker-preview';

const directories: string[] = [];

afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

test('an older preview gains a scheduler secret without replacing database or authentication credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-docker-upgrade-'));
  directories.push(root);
  const path = join(root, '.env.docker.local');
  const existing =
    'POSTGRES_PASSWORD=preserved\nMINIO_PASSWORD=preserved-storage\nBETTER_AUTH_SECRET=preserved-auth\n';
  await writeFile(path, existing, { mode: 0o600 });
  await ensureDockerPreviewScheduler(root);
  const upgraded = await readFile(path, 'utf8');
  expect(upgraded.startsWith(existing)).toBe(true);
  expect(upgraded).toMatch(/CRON_SECRET=[a-f0-9]{64}/);
  await ensureDockerPreviewScheduler(root);
  expect(await readFile(path, 'utf8')).toBe(upgraded);
});

test.each(['', '  ', '""', "''", '"  "', ' # not configured', '"\n\n"'])(
  'scheduler initialization replaces the empty dotenv value %j',
  async (value) => {
    const root = await mkdtemp(join(tmpdir(), 'orbit-docker-empty-cron-'));
    directories.push(root);
    const path = join(root, '.env.docker.local');
    await writeFile(path, `POSTGRES_PASSWORD=preserved\r\nCRON_SECRET=${value}\r\n`);
    await ensureDockerPreviewScheduler(root);
    const upgraded = await readFile(path, 'utf8');
    expect(parseEnv(upgraded)['CRON_SECRET']).toMatch(/^[a-f0-9]{64}$/);
    expect(parseEnv(upgraded)['POSTGRES_PASSWORD']).toBe('preserved');
    await ensureDockerPreviewScheduler(root);
    expect(await readFile(path, 'utf8')).toBe(upgraded);
  },
);

test('scheduler initialization preserves a configured quoted credential', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-docker-existing-cron-'));
  directories.push(root);
  const path = join(root, '.env.docker.local');
  const existing = 'CRON_SECRET="existing-secret" # preserve this credential\r\n';
  await writeFile(path, existing);
  await ensureDockerPreviewScheduler(root);
  expect(await readFile(path, 'utf8')).toBe(existing);
});

test('exported dependency links resolve after the build directory is removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-docker-export-'));
  directories.push(root);
  const source = join(root, 'build');
  const output = join(root, 'output');
  const dependency = join(source, 'node_modules', '@aws-sdk', 'client-s3');
  const aliases = join(source, 'apps', 'web', '.next', 'node_modules', '@aws-sdk');
  await mkdir(dependency, { recursive: true });
  await mkdir(aliases, { recursive: true });
  await writeFile(join(dependency, 'package.json'), '{"name":"@aws-sdk/client-s3"}');
  await symlink(
    '../../../../../node_modules/@aws-sdk/client-s3',
    join(aliases, 'client-s3-generated-alias'),
  );
  await exportStandalone(source, output);
  await rm(source, { recursive: true });
  const exported = join(
    output,
    'standalone',
    'apps',
    'web',
    '.next',
    'node_modules',
    '@aws-sdk',
    'client-s3-generated-alias',
    'package.json',
  );
  expect(JSON.parse(await readFile(exported, 'utf8'))).toEqual({ name: '@aws-sdk/client-s3' });
});

test('preview initialization creates private distinct secrets and refuses to rotate existing data credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-docker-preview-'));
  directories.push(root);
  await initializeDockerPreview(root);
  const file = join(root, '.env.docker.local');
  const original = await readFile(file, 'utf8');
  const values = original.trim().split('\n');
  expect(values).toHaveLength(4);
  expect(new Set(values.map((value) => value.split('=')[1])).size).toBe(4);
  for (const value of values) expect(value).toMatch(/^[A-Z_]+=[a-f0-9]{64}$/);
  await expect(initializeDockerPreview(root)).rejects.toThrow('EEXIST');
  expect(await readFile(file, 'utf8')).toBe(original);
});

test('preview credentials are readable only by their owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-docker-permissions-'));
  directories.push(root);
  await initializeDockerPreview(root);
  const handle = await open(join(root, '.env.docker.local'), 'r');
  try {
    expect((await handle.stat()).mode & 0o777).toBe(0o600);
  } finally {
    await handle.close();
  }
});

test('one-command startup initializes once and preserves credentials on retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-docker-start-'));
  directories.push(root);
  const commands: string[][] = [];
  const run = (command: string[], cwd: string) => {
    expect(cwd).toBe(root);
    commands.push(command);
    return Promise.resolve();
  };
  await startDockerPreview(root, run);
  const original = await readFile(join(root, '.env.docker.local'), 'utf8');
  expect(commands.map((command) => command.at(-1))).toEqual([
    'version',
    '{{.ServerVersion}}',
    'preview:tools',
    'preview:infra',
    'preview:migrate',
    'preview:build',
    'preview:up',
    'preview:storage-check',
    'preview:status',
  ]);
  await startDockerPreview(root, run);
  expect(await readFile(join(root, '.env.docker.local'), 'utf8')).toBe(original);
});

test('failed migrations stop startup before building or replacing the running application', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-docker-failure-'));
  directories.push(root);
  const commands: string[] = [];
  await expect(
    startDockerPreview(root, (command) => {
      commands.push(command.join(' '));
      if (command.includes('preview:migrate'))
        return Promise.reject(new Error('Migration failed.'));
      return Promise.resolve();
    }),
  ).rejects.toThrow('Migration failed.');
  expect(commands.some((command) => command.includes('preview:build'))).toBe(false);
  expect(commands.some((command) => command.includes('preview:up'))).toBe(false);
});
