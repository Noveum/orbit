import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function initializeDockerPreview(root: string): Promise<void> {
  const values = ['POSTGRES_PASSWORD', 'MINIO_PASSWORD', 'BETTER_AUTH_SECRET'].map(
    (name) => `${name}=${randomBytes(32).toString('hex')}`,
  );
  await writeFile(resolve(root, '.env.docker.local'), `${values.join('\n')}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

if (import.meta.main) {
  await initializeDockerPreview(resolve(import.meta.dir, '..'));
  console.info(
    'Created .env.docker.local. Keep this file private and preserve it across upgrades.',
  );
}
