import { expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';

it('propagates an alarm failure so the stored work can be retried', async () => {
  const fixture = fileURLToPath(new URL('deferred-work.fixture.ts', import.meta.url));
  const result = Bun.spawn(['bun', fixture], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [status, errors] = await Promise.all([result.exited, new Response(result.stderr).text()]);
  expect(status, errors).toBe(0);
});
