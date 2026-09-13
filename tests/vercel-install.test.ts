import { afterEach, expect, it } from 'bun:test';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { removeCachedDependencies } from '../scripts/vercel-install.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('removes cached dependencies from every workspace without removing source or lockfiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-install-'));
  roots.push(root);
  const workspaces = ['apps/web', 'apps/realtime', 'packages/db', 'packages/shared'];
  for (const workspace of ['', ...workspaces]) {
    await mkdir(join(root, workspace, 'node_modules'), { recursive: true });
    await writeFile(join(root, workspace, 'package.json'), '{}');
  }
  await writeFile(join(root, 'bun.lock'), 'preserved lockfile');
  await symlink(
    '../../../node_modules/.bun/stale/drizzle-orm',
    join(root, 'packages/db/node_modules/drizzle-orm'),
  );

  await removeCachedDependencies(root);

  for (const workspace of ['', ...workspaces]) {
    expect(await lstat(join(root, workspace, 'node_modules')).catch(() => null)).toBeNull();
    expect(await Bun.file(join(root, workspace, 'package.json')).text()).toBe('{}');
  }
  expect(await Bun.file(join(root, 'bun.lock')).text()).toBe('preserved lockfile');
  await removeCachedDependencies(root);
});

it('runs a frozen install from the repository root and propagates installation failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-install-entrypoint-'));
  roots.push(root);
  for (const directory of ['scripts', 'apps/web', 'packages/db']) {
    await mkdir(join(root, directory), { recursive: true });
  }
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'install-fixture',
      private: true,
      dependencies: { '@fixture/db': 'workspace:*' },
      workspaces: ['apps/*', 'packages/*'],
    }),
  );
  await writeFile(join(root, 'packages/db/package.json'), JSON.stringify({ name: '@fixture/db' }));
  await writeFile(join(root, 'apps/web/package.json'), JSON.stringify({ name: '@fixture/web' }));
  await Bun.write(
    join(root, 'scripts/vercel-install.ts'),
    Bun.file(new URL('../scripts/vercel-install.ts', import.meta.url)),
  );
  const lock = Bun.spawn([process.execPath, 'install', '--lockfile-only'], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  expect(await lock.exited).toBe(0);

  const runInstall = () =>
    Bun.spawn([process.execPath, '../../scripts/vercel-install.ts'], {
      cwd: join(root, 'apps/web'),
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env['PATH'] ?? ''}`,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

  expect(await runInstall().exited).toBe(0);
  expect((await lstat(join(root, 'node_modules/@fixture/db'))).isSymbolicLink()).toBe(true);

  await writeFile(join(root, 'bun.lock'), 'invalid lockfile');
  expect(await runInstall().exited).not.toBe(0);
});
