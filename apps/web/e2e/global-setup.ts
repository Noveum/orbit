import { resolve } from 'node:path';

export default async function globalSetup(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const seed = Bun.spawn(['bun', 'run', '--filter', '@orbit/db', 'seed'], {
    cwd: repoRoot,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: process.env,
  });
  const code = await seed.exited;
  if (code !== 0) throw new Error(`Seeding the end to end database failed with exit code ${code}.`);
}
