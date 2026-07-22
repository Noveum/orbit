import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['ORBIT_E2E_BASE_URL'] ?? 'http://localhost:3011',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
