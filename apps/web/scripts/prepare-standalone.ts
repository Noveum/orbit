import { cp, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function requireDirectory(path: string): Promise<void> {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('Missing standalone output');
    }
    throw error;
  }
  throw new Error('Missing standalone output');
}

export async function prepareStandalone(root: string, vercel: string | undefined): Promise<void> {
  if (vercel === '1') return;
  const standalone = join(root, '.next', 'standalone', 'apps', 'web');
  await requireDirectory(standalone);
  await mkdir(join(standalone, '.next'), { recursive: true });
  await cp(join(root, 'public'), join(standalone, 'public'), { recursive: true });
  await cp(join(root, '.next', 'static'), join(standalone, '.next', 'static'), {
    recursive: true,
  });
  const result = await Bun.build({
    entrypoints: [join(root, 'src', 'start.ts')],
    target: 'node',
    format: 'esm',
    outdir: standalone,
    naming: 'start.mjs',
  });
  if (!result.success)
    throw new AggregateError(result.logs, 'Failed to build standalone entrypoint');
}

if (import.meta.main)
  await prepareStandalone(resolve(import.meta.dir, '..'), process.env['VERCEL']);
