import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareStandalone } from '../../scripts/prepare-standalone.ts';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('prepareStandalone', () => {
  it('leaves Vercel builds for the platform to trace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orbit-standalone-'));
    roots.push(root);
    await expect(prepareStandalone(root, '1')).resolves.toBeUndefined();
  });

  it('refuses a local build without standalone output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orbit-standalone-'));
    roots.push(root);
    await expect(prepareStandalone(root, undefined)).rejects.toThrow('Missing standalone output');
  });

  it('copies public assets and static output and builds the node entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orbit-standalone-'));
    roots.push(root);
    await mkdir(join(root, 'public'), { recursive: true });
    await mkdir(join(root, '.next', 'static'), { recursive: true });
    await mkdir(join(root, '.next', 'standalone', 'apps', 'web'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'public', 'asset.txt'), 'public asset');
    await writeFile(join(root, '.next', 'static', 'chunk.js'), 'static chunk');
    await writeFile(join(root, 'src', 'start.ts'), "process.stdout.write('ready');\n");

    await prepareStandalone(root, undefined);

    const standalone = join(root, '.next', 'standalone', 'apps', 'web');
    expect(await readFile(join(standalone, 'public', 'asset.txt'), 'utf8')).toBe('public asset');
    expect(await readFile(join(standalone, '.next', 'static', 'chunk.js'), 'utf8')).toBe(
      'static chunk',
    );
    expect(await readFile(join(standalone, 'start.mjs'), 'utf8')).toContain('ready');
  });
});
