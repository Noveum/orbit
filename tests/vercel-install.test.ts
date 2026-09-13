import { afterEach, expect, it } from 'bun:test';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
