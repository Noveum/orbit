import { expect, it } from 'bun:test';

for (const mode of ['catalog', 'release', 'readiness', 'preflight']) {
  it(`enforces verified TLS before the first ${mode} database query`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        new URL('./fixtures/tls-wiring.ts', import.meta.url).pathname,
        mode,
      ],
      {
        env: { PATH: process.env['PATH'], DATABASE_REQUIRE_TLS: 'true' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({ verifiedTls: true, noDatabaseQuery: true });
  });
}
