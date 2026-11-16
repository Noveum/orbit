import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

describe('account credential removal', () => {
  it('removes the selected provider account with the local row selector required by the auth API', () => {
    const fixture = fileURLToPath(
      new URL('../../fixtures/auth-credentials.fixture.ts', import.meta.url),
    );
    const child = Bun.spawnSync([process.execPath, fixture], {
      cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
      env: {
        PATH: process.env['PATH'] ?? '',
        NODE_ENV: 'test',
        CI: 'true',
        DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/orbit_test_auth_fixture',
        DATABASE_POOL_MAX: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    });
    expect(child.exitCode).toBe(0);
    const output = new TextDecoder().decode(child.stdout).trim().split('\n').at(-1) ?? '';
    const result = z
      .object({
        status: z.number(),
        googleAccounts: z.number(),
        credentialAccounts: z.number(),
      })
      .parse(JSON.parse(output));
    expect(result).toEqual({ status: 200, googleAccounts: 0, credentialAccounts: 1 });
  });
});
