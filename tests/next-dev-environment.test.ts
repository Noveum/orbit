import { afterEach, expect, test } from 'bun:test';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { nodeRuntimePath } from '../scripts/next-dev-environment.ts';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test('removes only node entries linked to Bun and preserves the remaining search order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-next-runtime-'));
  directories.push(directory);
  const executable = join(directory, 'bun-runtime');
  await writeFile(executable, 'bun fixture');
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const symbolicShim = join(directory, 'symbolic shim');
  const hardLinkedShim = join(directory, 'hard-linked shim');
  const nativeNode = join(directory, 'native node');
  for (const path of [symbolicShim, hardLinkedShim, nativeNode]) {
    await mkdir(path);
  }
  const createSymbolicShim = process.platform === 'win32' ? link : symlink;
  await createSymbolicShim(executable, join(symbolicShim, nodeName));
  await link(executable, join(hardLinkedShim, nodeName));
  await writeFile(join(nativeNode, nodeName), 'node fixture');
  const missing = join(directory, 'missing');
  const pathValue = [symbolicShim, nativeNode, missing, hardLinkedShim, nativeNode, ''].join(
    delimiter,
  );

  expect(await nodeRuntimePath(pathValue, executable)).toBe(
    [nativeNode, missing, nativeNode, ''].join(delimiter),
  );
});
