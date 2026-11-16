import { expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

for (const mode of ['idle', 'foreign', 'reconnect', 'active-boundary', 'presence'] as const) {
  it(`avoids unobserved realtime work through ${mode}`, () => {
    const child = Bun.spawnSync(
      [
        process.execPath,
        '--no-env-file',
        fileURLToPath(new URL('./fixtures/hub-unobserved.fixture.ts', import.meta.url)),
        mode,
      ],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        env: {
          PATH: process.env['PATH'] ?? '',
          NODE_ENV: 'test',
          BUN_OPTIONS: '--no-env-file',
          DATABASE_URL: 'postgres://127.0.0.1:1/orbit_test_unused',
        },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 15_000,
      },
    );
    if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
    const output = new TextDecoder().decode(child.stdout).trim();
    expect(
      z.object({ completed: z.literal(true), mode: z.literal(mode) }).parse(JSON.parse(output))
        .completed,
    ).toBe(true);
  }, 20_000);
}
