import { fileURLToPath } from 'node:url';
import { applyCatchup } from './apply-catchup.ts';
import { releaseDatabase } from './migration-release.ts';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function prepareTestDatabase(url: string): Promise<void> {
  await releaseDatabase(url, MIGRATIONS);
  await applyCatchup(url, 'agent-actors.sql');
}
