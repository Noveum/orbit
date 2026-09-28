import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.ts';

const outputDir = process.env['ORBIT_E2E_PRIVATE_RESULTS_DIR'];
if (outputDir === undefined || outputDir.length === 0) {
  throw new Error('The private Agent release output directory is required.');
}

export default defineConfig({
  ...baseConfig,
  testMatch: ['mcp-http-release.spec.ts', 'mcp-http-writer-off.spec.ts'],
  testIgnore: [],
  outputDir,
  use: { ...baseConfig.use, trace: 'off' },
});
