import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportStandalone } from '../scripts/export-docker-preview';
import { initializeDockerPreview } from '../scripts/init-docker-preview';

const directories: string[] = [];

afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
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
  expect(values).toHaveLength(3);
  expect(new Set(values.map((value) => value.split('=')[1])).size).toBe(3);
  for (const value of values) expect(value).toMatch(/^[A-Z_]+=[a-f0-9]{64}$/);
  const handle = await open(file, 'r');
  try {
    expect((await handle.stat()).mode & 0o777).toBe(0o600);
  } finally {
    await handle.close();
  }
  await expect(initializeDockerPreview(root)).rejects.toThrow('EEXIST');
  expect(await readFile(file, 'utf8')).toBe(original);
});
