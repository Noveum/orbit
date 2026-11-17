import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

const root = resolve(import.meta.dir, '../../../../..');
const route = z
  .enum([
    'webhooks/github',
    'cron/notifications',
    'cron/project-staleness',
    'cron/analytics-snapshots',
    'cron/sprint-rollover',
    'cron/prune',
  ])
  .parse(process.argv[2]);
const directory = z
  .string()
  .startsWith(join(root, 'node_modules/.cache/orbit-cold-import-'))
  .parse(process.argv[3]);
const external = new Set<string>();
for (const path of [
  join(root, 'package.json'),
  join(root, 'apps/web/package.json'),
  ...(await readdir(join(root, 'packages'))).map((name) =>
    join(root, 'packages', name, 'package.json'),
  ),
]) {
  const definition = z
    .object({
      dependencies: z.record(z.string(), z.string()).optional(),
      devDependencies: z.record(z.string(), z.string()).optional(),
    })
    .parse(JSON.parse(await readFile(path, 'utf8')));
  for (const name of Object.keys({ ...definition.dependencies, ...definition.devDependencies }))
    if (!name.startsWith('@orbit/')) external.add(name);
}
const built = await Bun.build({
  entrypoints: [join(root, `apps/web/src/app/api/${route}/route.ts`)],
  target: 'node',
  format: 'esm',
  packages: 'bundle',
  external: [...external],
  env: 'disable',
  outdir: directory,
  naming: 'route.mjs',
  plugins: [
    {
      name: 'cold-auth-observation',
      setup(build) {
        build.onLoad({ filter: /\/lib\/auth\/server\.ts$/ }, async (args) => ({
          contents: `Reflect.set(globalThis, 'orbitColdAuthInitializations', (Reflect.get(globalThis, 'orbitColdAuthInitializations') ?? 0) + 1);\n${await readFile(args.path, 'utf8')}\nReflect.set(globalThis, 'orbitColdAuthContext', auth.$context);`,
          loader: 'ts',
          resolveDir: dirname(args.path),
        }));
      },
    },
  ],
});

if (!built.success || built.logs.length !== 0) throw new Error(built.logs.map(String).join('\n'));
