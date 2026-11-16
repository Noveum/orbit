import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

describe('patched MCP OAuth integration', () => {
  for (const mode of [
    'grant',
    'provider-revoke',
    'replay',
    'session',
    'session-read',
    'migration',
    'legacy-public',
    'legacy-basic',
    'legacy-post',
    'foreign-resource',
    'legacy-unlink',
    'legacy-no-resource',
    'legacy-late-public',
    'legacy-late-basic',
    'legacy-late-post',
    'legacy-late-disabled',
    'legacy-late-invalid',
    'legacy-post-wrong',
    'modern-basic',
    'modern-basic-post',
    'registration',
    'legacy-mixed',
    'legacy-late-mixed',
    'legacy-mixed-custom',
    'legacy-late-mixed-custom',
    'legacy-deleted-client',
    'deleted-client',
    'disabled-client',
    'legacy-reserved',
    'legacy-late-reserved',
    'legacy-userinfo',
    'legacy-late-userinfo',
    'legacy-foreign-http',
    'legacy-late-foreign-http',
    'legacy-fragment',
    'legacy-late-fragment',
  ] as const) {
    it(`keeps workspace-bound credentials safe through ${mode}`, () => {
      const databaseUrl = process.env['DATABASE_URL'] ?? '';
      const database = new URL(databaseUrl);
      if (
        !(
          ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
          /^\/orbit_test_web(?:_[a-z0-9]+)?$/.test(database.pathname)
        )
      ) {
        throw new Error('The auth integration requires an explicit loopback web test database.');
      }
      const child = Bun.spawnSync(
        [
          process.execPath,
          fileURLToPath(new URL('../../fixtures/auth-mcp-upgrade.fixture.ts', import.meta.url)),
          mode,
        ],
        {
          cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
          env: {
            PATH: process.env['PATH'] ?? '',
            NODE_ENV: 'test',
            CI: 'true',
            DATABASE_URL: databaseUrl,
            DATABASE_POOL_MAX: '2',
            BETTER_AUTH_SECRET: 'local-auth-integration-secret-20261116',
            BETTER_AUTH_URL: 'http://localhost:3000',
            NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
            ALLOWED_EMAIL_DOMAINS: '',
          },
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 60_000,
        },
      );
      if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
      const output = new TextDecoder().decode(child.stdout).trim().split('\n').at(-1) ?? '';
      const result = z
        .object({
          completed: z.literal(true),
          mode: z.literal(mode),
        })
        .parse(JSON.parse(output));
      expect(result.completed).toBe(true);
    }, 65_000);
  }
});
