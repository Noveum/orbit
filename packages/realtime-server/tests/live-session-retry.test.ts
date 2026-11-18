import { expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

for (const mode of ['recover', 'expire', 'bounded', 'permission', 'empty'] as const) {
  it(`keeps live session queries bounded through ${mode}`, () => {
    const child = Bun.spawnSync(
      [
        process.execPath,
        '--no-env-file',
        fileURLToPath(new URL('./fixtures/live-session-retry.fixture.ts', import.meta.url)),
        mode,
      ],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'test', BUN_OPTIONS: '--no-env-file' },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 10_000,
      },
    );
    if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
    const result = z
      .object({
        completed: z.literal(true),
        mode: z.literal(mode),
        deniedConnections: z.literal(0),
        externalFetches: z.literal(0),
        realDatabaseConnections: z.literal(0),
      })
      .parse(JSON.parse(new TextDecoder().decode(child.stdout)));
    expect(result.completed).toBe(true);
  }, 15_000);
}
