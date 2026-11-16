import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

describe('email OTP mailbox proof', () => {
  it('removes unproven credentials and their existing sessions before the verified mailbox signs in', () => {
    const child = Bun.spawnSync(
      [
        process.execPath,
        fileURLToPath(new URL('../../fixtures/auth-email-otp.fixture.ts', import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
        env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'test', CI: 'true' },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 30_000,
      },
    );
    if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
    const output = new TextDecoder().decode(child.stdout).trim().split('\n').at(-1) ?? '';
    const result = z
      .object({
        mailboxProof: z.literal(true),
        unprovenCredentialsRemoved: z.literal(true),
        oldSessionRevoked: z.literal(true),
      })
      .parse(JSON.parse(output));
    expect(result.mailboxProof).toBe(true);
  });
});
