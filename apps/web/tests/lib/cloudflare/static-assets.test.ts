import { expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const wranglerSchema = z.object({
  assets: z.object({ run_worker_first: z.array(z.string()) }),
});

it('serves every public file from the edge instead of through the placed Worker', async () => {
  const wrangler = wranglerSchema.parse(
    JSON.parse(await readFile(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8')),
  );
  const servedAtTheEdge = new Set(
    wrangler.assets.run_worker_first
      .filter((rule) => rule.startsWith('!'))
      .map((rule) => rule.slice(1)),
  );
  const publicDirectory = fileURLToPath(new URL('../../../public/', import.meta.url));
  const publicFiles = new Bun.Glob('**/*').scanSync({
    cwd: publicDirectory,
    dot: true,
    onlyFiles: true,
  });
  const missing = Array.from(publicFiles, (file) => `/${file.replaceAll('\\', '/')}`).filter(
    (path) => !servedAtTheEdge.has(path),
  );
  expect(missing).toEqual([]);
});
