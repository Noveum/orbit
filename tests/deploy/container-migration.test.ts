import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('the catalog migration entrypoint runs under Node and refuses missing database configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-container-migration-test-'));
  try {
    const build = await Bun.build({
      entrypoints: [resolve('scripts/container-migrate.ts')],
      outdir: directory,
      target: 'node',
      format: 'esm',
      naming: 'migrate.mjs',
    });
    expect(build.success).toBe(true);
    const child = Bun.spawn(['node', join(directory, 'migrate.mjs')], {
      env: { PATH: process.env['PATH'] ?? '', DATABASE_URL: '', DIRECT_URL: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited).not.toBe(0);
    expect(output).toContain('Set DIRECT_URL or DATABASE_URL before starting Orbit.');
    expect(output).not.toContain('Bun is not defined');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(['', 'postgres://direct.example.test/orbit'])(
  'the catalog migration entrypoint selects the database when DIRECT_URL is %s',
  async (direct) => {
    const directory = await mkdtemp(join(tmpdir(), 'orbit-container-migration-url-'));
    try {
      const build = await Bun.build({
        entrypoints: [resolve('scripts/container-migrate.ts')],
        outdir: directory,
        target: 'node',
        format: 'esm',
        naming: 'migrate.mjs',
        plugins: [
          {
            name: 'migration-release-fixture',
            setup(builder) {
              builder.onResolve({ filter: /migration-release$/ }, () => ({
                path: 'release',
                namespace: 'fixture',
              }));
              builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                contents:
                  'export async function releaseDatabase(url) { console.log(url); return { mode: "test", applied: 0 }; }',
                loader: 'js',
              }));
            },
          },
        ],
      });
      expect(build.success).toBe(true);
      const child = Bun.spawn(['node', join(directory, 'migrate.mjs')], {
        env: {
          PATH: process.env['PATH'] ?? '',
          DATABASE_URL: 'postgres://fallback.example.test/orbit',
          DIRECT_URL: direct,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(output).toContain(direct || 'postgres://fallback.example.test/orbit');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
