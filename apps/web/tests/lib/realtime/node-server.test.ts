import { expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('runs standalone realtime security and lifecycle checks under Node', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-node-realtime-'));
  try {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, 'node-server.fixture.ts')],
      target: 'node',
      format: 'esm',
      outdir: directory,
      naming: '[name].mjs',
    });
    expect(result.success).toBe(true);
    const child = Bun.spawn(['node', join(directory, 'node-server.fixture.mjs')], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const timeout = setTimeout(() => child.kill(), 10_000);
    const [code, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    clearTimeout(timeout);
    expect({ code, errors }).toEqual({ code: 0, errors: '' });
    expect(output).toContain('All realtime checks passed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
