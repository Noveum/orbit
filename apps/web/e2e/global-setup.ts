import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function globalSetup(): void {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  execFileSync('bun', ['run', '--filter', '@orbit/db', 'seed'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
}
