import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['ORBIT_E2E_BASE_URL'] ?? 'http://localhost:3011',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
