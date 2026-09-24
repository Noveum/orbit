import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export async function initializeDockerPreview(root: string): Promise<void> {
  const values = ['POSTGRES_PASSWORD', 'MINIO_PASSWORD', 'BETTER_AUTH_SECRET', 'CRON_SECRET'].map(
    (name) => `${name}=${randomBytes(32).toString('hex')}`,
  );
  await writeFile(resolve(root, '.env.docker.local'), `${values.join('\n')}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

export async function ensureDockerPreviewScheduler(root: string): Promise<void> {
  const path = resolve(root, '.env.docker.local');
  const existing = await readFile(path, 'utf8');
  if (parseEnv(existing)['CRON_SECRET']?.trim()) return;
  const secret = `CRON_SECRET=${randomBytes(32).toString('hex')}`;
  const updated = `${existing.trimEnd()}\n${secret}\n`;
  await writeFile(path, updated, { mode: 0o600 });
}

if (import.meta.main) {
  await initializeDockerPreview(resolve(import.meta.dir, '..'));
  console.info(
    'Created .env.docker.local. Keep this file private and preserve it across upgrades.',
  );
}
