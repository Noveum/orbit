import { spawn } from 'node:child_process';
import { ensureLaneDatabase } from '../packages/db/src/test-lane.ts';
import { resolveTestDatabaseUrl } from './test-env.ts';

const baseDatabase = process.argv[2];

if (baseDatabase === undefined) {
  throw new Error('Pass the package test database name as the first argument.');
}

const databaseUrl = resolveTestDatabaseUrl(baseDatabase);
await ensureLaneDatabase(databaseUrl, baseDatabase);

const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  ORBIT_TEST_REDIS_URL: process.env['REDIS_URL'] ?? '',
};

const child = spawn(process.execPath, ['--env-file=../../.env', 'test', ...process.argv.slice(3)], {
  cwd: process.cwd(),
  env: environment,
  stdio: 'inherit',
});

const exitCode = await new Promise<number>((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (code) => resolve(code ?? 1));
});

process.exitCode = exitCode;
