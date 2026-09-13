import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function removeCachedDependencies(root: string): Promise<void> {
  const directories = [join(root, 'node_modules')];
  for (const parent of ['apps', 'packages']) {
    const entries = await readdir(join(root, parent), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) directories.push(join(root, parent, entry.name, 'node_modules'));
    }
  }
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await removeCachedDependencies(root);
  const install = Bun.spawn(['bun', 'install', '--frozen-lockfile'], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exit(await install.exited);
}
