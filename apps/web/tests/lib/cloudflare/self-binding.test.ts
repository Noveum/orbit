import { expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const wranglerSchema = z.object({
  services: z.array(z.object({ binding: z.string() })).default([]),
});

it('keeps authenticated scheduled jobs on the deployed Worker until its operator opts into placement', async () => {
  const wrangler = wranglerSchema.parse(
    JSON.parse(await readFile(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8')),
  );
  expect(wrangler.services.map((service) => service.binding)).not.toContain('SELF');
});

it('dispatches the deployed scheduled entry through its own service binding when provided', async () => {
  const fixture = fileURLToPath(new URL('scheduled.fixture.ts', import.meta.url));
  const child = Bun.spawn(['bun', fixture], { stdout: 'pipe', stderr: 'pipe' });
  const [status, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(status, errors).toBe(0);
});
