import { expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';

it('enforces Worker socket transport limits and preserves the session sweep deadline', async () => {
  const fixture = fileURLToPath(new URL('realtime-hub.fixture.ts', import.meta.url));
  const child = Bun.spawn(['bun', fixture], { stdout: 'pipe', stderr: 'pipe' });
  const [status, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(status, errors).toBe(0);
});
