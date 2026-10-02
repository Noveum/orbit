import { createHash } from 'node:crypto';
import { ensureLaneDatabase } from '@orbit/db/test-lane';
import { defineConfig, devices } from '@playwright/test';
import { nodeRuntimePath } from '../../scripts/next-dev-environment.ts';
import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

const { BASE } = await import('./e2e/base-url.ts');
process.env['ORBIT_E2E_BASE_URL'] = BASE;
const WEB_PORT = new URL(BASE).port || '3000';
const REALTIME_PORT = process.env['ORBIT_E2E_REALTIME_PORT'] ?? '3101';
const REALTIME_URL = `ws://localhost:${REALTIME_PORT}`;
const nextServerEnvironment =
  process.versions['bun'] === undefined
    ? {}
    : { PATH: await nodeRuntimePath(process.env['PATH'] ?? '', process.execPath) };
const databaseUrl = resolveTestDatabaseUrl('orbit_test_web');
await ensureLaneDatabase(databaseUrl, 'orbit_test_web');
const databaseTarget = new URL(databaseUrl);
const username = decodeURIComponent(databaseTarget.username);
for (const key of ['NO_PROXY', 'no_proxy']) {
  const entries =
    process.env[key]
      ?.split(/[;,]/)
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];
  process.env[key] = [...new Set([...entries, 'localhost', '127.0.0.1', '::1'])].join(',');
}
process.env['DATABASE_URL'] = databaseUrl;
process.env['BETTER_AUTH_URL'] = BASE;
process.env['NEXT_PUBLIC_APP_URL'] = BASE;
process.env['NEXT_PUBLIC_REALTIME_URL'] = REALTIME_URL;
process.env['ORBIT_SEED_CONFIRM_TARGET'] =
  `${databaseTarget.hostname.toLowerCase()}:${databaseTarget.port}/${databaseTarget.pathname.slice(1)}:user-sha256:${createHash('sha256').update(username).digest('hex')}`;
process.env['ORBIT_AGENT_IDENTITY_READ'] ??= 'true';
process.env['ORBIT_AGENT_CONSENT'] ??= 'true';
process.env['ORBIT_AGENT_ISSUE_WRITE'] ??= 'true';
process.env['ORBIT_ISSUE_OUTBOX_DISPATCH'] ??= 'true';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/mcp-http-release.spec.ts', '**/mcp-http-writer-off.spec.ts'],
  globalSetup: './e2e/global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    trace: process.env['ORBIT_E2E_TRACE'] === 'off' ? 'off' : 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: `bun --env-file=../../.env next dev --port ${WEB_PORT}`,
      url: `${BASE}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: nextServerEnvironment,
    },
    {
      command: 'bun --env-file=../../.env ../../apps/realtime/src/index.ts',
      url: `http://localhost:${REALTIME_PORT}/readyz`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { REALTIME_PORT },
    },
  ],
});
