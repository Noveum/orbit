import { expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

for (const mode of ['serial', 'close', 'removed', 'terminal'] as const) {
  it(`preserves session sweep lifecycle through ${mode}`, () => {
    const child = Bun.spawnSync(
      [
        process.execPath,
        '--no-env-file',
        fileURLToPath(new URL('./fixtures/hub-session-sweep.fixture.ts', import.meta.url)),
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
    expect(
      z
        .object({ completed: z.literal(true), mode: z.literal(mode), network: z.literal(0) })
        .parse(JSON.parse(new TextDecoder().decode(child.stdout))).completed,
    ).toBe(true);
  }, 15_000);
}
