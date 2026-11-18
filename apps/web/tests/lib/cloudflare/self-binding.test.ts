import { expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const wranglerSchema = z.object({
  name: z.string(),
  placement: z.object({ region: z.string() }),
  services: z.array(z.object({ binding: z.string(), service: z.string() })),
});

it('gives scheduled runs a binding back to the same Worker, so jobs run where it is placed', async () => {
  const wrangler = wranglerSchema.parse(
    JSON.parse(await readFile(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8')),
  );
  expect(wrangler.services).toContainEqual({ binding: 'SELF', service: wrangler.name });
});
