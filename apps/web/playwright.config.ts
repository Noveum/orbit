import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const repositoryEnvFile = resolve(import.meta.dirname, '../../.env');
if (existsSync(repositoryEnvFile)) process.loadEnvFile(repositoryEnvFile);

const { BASE } = await import('./e2e/base-url.ts');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
