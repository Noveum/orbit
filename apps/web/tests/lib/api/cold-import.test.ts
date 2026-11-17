import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const root = resolve(import.meta.dir, '../../../../..');
const resultSchema = z.object({
  runtime: z.string(),
  handlerExported: z.boolean(),
  authInitializations: z.number(),
  connectionAttempts: z.number(),
  fetchAttempts: z.number(),
  startupSeedErrors: z.number(),
});

for (const route of [
  'webhooks/github',
  'cron/notifications',
  'cron/project-staleness',
  'cron/analytics-snapshots',
  'cron/sprint-rollover',
  'cron/prune',
]) {
  test(`${route} cold import starts no session auth or OAuth database work under Node`, async () => {
    await mkdir(join(root, 'node_modules/.cache'), { recursive: true });
    const directory = await mkdtemp(join(root, 'node_modules/.cache/orbit-cold-import-'));
    try {
      const compilation = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          join(import.meta.dir, 'cold-import.build.ts'),
          route,
          directory,
        ],
        {
          cwd: root,
          env: { PATH: process.env['PATH'] ?? '', BUN_OPTIONS: '--no-env-file' },
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 15000,
        },
      );
      const [compiled, compilationOutput, compilationErrors] = await Promise.all([
        compilation.exited,
        new Response(compilation.stdout).text(),
        new Response(compilation.stderr).text(),
      ]);
      expect({ compiled, compilationOutput, compilationErrors }).toEqual({
        compiled: 0,
        compilationOutput: '',
        compilationErrors: '',
      });
      const node = Bun.which('node');
      if (node === null) throw new Error('Node is required for the cold import regression');
      const child = Bun.spawn(
        [node, join(import.meta.dir, 'cold-import.fixture.mjs'), join(directory, 'route.mjs')],
        {
          cwd: directory,
          env: {
            PATH: process.env['PATH'] ?? '',
            NODE_ENV: 'production',
            BETTER_AUTH_SECRET: 'cold-import-fixture-secret-only-0123456789',
            BETTER_AUTH_URL: 'http://localhost:3000',
            NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
            ORBIT_PASSWORD_AUTH: 'true',
            DATABASE_URL: 'postgres://fixture:fixture@127.0.0.1:1/orbit_test_cold_import',
            DATABASE_PREPARED_STATEMENTS: 'false',
          },
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 15000,
        },
      );
      const [code, output, errors] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ code, errors }).toEqual({ code: 0, errors: '' });
      const result = resultSchema.parse(JSON.parse(output));
      expect(result.handlerExported).toBe(true);
      expect(result.fetchAttempts).toBe(0);
      expect({
        authInitializations: result.authInitializations,
        connectionAttempts: result.connectionAttempts,
        startupSeedErrors: result.startupSeedErrors,
      }).toEqual({ authInitializations: 0, connectionAttempts: 0, startupSeedErrors: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20000);
}
