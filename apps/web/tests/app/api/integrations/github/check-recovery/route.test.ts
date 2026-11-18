import { describe, expect, it, spyOn } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as principalModule from '@/lib/auth/principal.ts';

const cases = [
  ['unauthenticated', 'rejects an unauthenticated request before any provider operation'],
  ['non-manager', 'rejects a non-manager before any provider operation'],
  ['foreign-workspace', 'does not accept a target belonging to another workspace'],
  ['scope-overrides', 'refuses scope overrides and client token-freshness flags'],
  ['queued', 'queues one verified current head and returns only an idempotent finite status'],
  ['closed', 'does not queue a live closed pull request'],
  [
    'unavailable',
    'reports an unavailable installation without guessing a replacement or changing attempts',
  ],
] as const;

describe('POST exact GitHub check recovery', () => {
  for (const [mode, title] of cases) {
    it(title, async () => {
      const databaseUrl = process.env['DATABASE_URL'] ?? '';
      const database = new URL(databaseUrl);
      if (
        !(
          ['postgres:', 'postgresql:'].includes(database.protocol) &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
          /^\/orbit_test_web(?:_[a-z0-9]+)?$/.test(database.pathname)
        )
      )
        throw new Error('The recovery route requires an explicit loopback web test database.');
      const membershipSpy =
        mode === 'queued'
          ? spyOn(principalModule, 'resolveMembership').mockResolvedValue(null)
          : null;
      try {
        if (membershipSpy !== null)
          expect(
            await principalModule.resolveMembership('parent-only-contamination', null),
          ).toBeNull();
        const child = Bun.spawnSync(
          [
            process.execPath,
            '--no-env-file',
            fileURLToPath(
              new URL('../../../../../fixtures/github-check-recovery.fixture.ts', import.meta.url),
            ),
            mode,
          ],
          {
            cwd: fileURLToPath(new URL('../../../../../../../../', import.meta.url)),
            env: {
              PATH: process.env['PATH'] ?? '',
              NODE_ENV: 'test',
              BUN_OPTIONS: '--no-env-file',
              CI: 'true',
              DATABASE_URL: databaseUrl,
              DATABASE_POOL_MAX: '2',
              DATABASE_REQUIRE_TLS: 'false',
              DATABASE_PREPARED_STATEMENTS: 'false',
              BETTER_AUTH_SECRET: 'local-recovery-route-fixture-secret',
              BETTER_AUTH_URL: 'http://localhost:3000',
              NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
              ALLOWED_EMAIL_DOMAINS: '',
            },
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 20_000,
          },
        );
        if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
        const result = z
          .object({ completed: z.literal(true), mode: z.literal(mode) })
          .strict()
          .parse(JSON.parse(new TextDecoder().decode(child.stdout).trim()));
        expect(result.completed).toBe(true);
      } finally {
        membershipSpy?.mockRestore();
      }
    }, 25_000);
  }
});
