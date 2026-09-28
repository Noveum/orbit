import { access, cp, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function exportStandalone(source: string, output: string): Promise<void> {
  const pending = join(output, 'standalone.pending');
  const destination = join(output, 'standalone');
  await mkdir(output, { recursive: true });
  await rm(pending, { recursive: true, force: true });
  await cp(source, pending, { recursive: true, verbatimSymlinks: true });
  await rm(destination, { recursive: true, force: true });
  await rename(pending, destination);
}

if (import.meta.main) {
  try {
    await access('/workspace/apps/web/package.json');
    await access('/output');
  } catch {
    throw new Error('Run bun run preview:build from the repository root to build inside Docker.');
  }
  const build = Bun.spawn(['bun', 'run', 'build'], {
    cwd: '/workspace/apps/web',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await build.exited;
  if (code !== 0) process.exit(code);
  await exportStandalone('/workspace/apps/web/.next/standalone', '/output');
  console.info('Exported Linux standalone artifacts. Build the runtime image before starting web.');
}
