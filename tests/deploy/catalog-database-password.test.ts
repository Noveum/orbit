import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

test.each([
  { catalog: 'compose', service: 'web', hostname: 'postgres' },
  { catalog: 'compose', service: 'realtime', hostname: 'postgres' },
  { catalog: 'zeabur', service: 'web', hostname: 'postgres.zeabur.internal' },
  { catalog: 'zeabur', service: 'realtime', hostname: 'postgres.zeabur.internal' },
])(
  '$catalog $service encodes the raw database password',
  async ({ catalog, service, hostname }) => {
    const definition = Bun.YAML.parse(await Bun.file(`deploy/catalogs/${catalog}.yaml`).text());
    const command =
      catalog === 'compose'
        ? z
            .object({
              services: z.record(z.string(), z.object({ command: z.array(z.string()).optional() })),
            })
            .parse(definition).services[service]?.command
        : z
            .object({
              spec: z.object({
                services: z.array(
                  z.object({
                    name: z.string(),
                    spec: z.object({
                      source: z.object({ command: z.array(z.string()).optional() }),
                    }),
                  }),
                ),
              }),
            })
            .parse(definition)
            .spec.services.find((item) => item.name === service)?.spec.source.command;
    expect(command).toBeDefined();
    const script = command?.[2];
    if (script === undefined) throw new Error('Missing catalog startup command');
    const directory = await mkdtemp(join(tmpdir(), 'orbit-catalog-password-'));
    const password = 'test/p@ss:#?%+with space$(echo unsafe)';
    try {
      await writeFile(
        join(directory, 'node'),
        `#!${Bun.which('node')}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '-e') {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
process.stdout.write(JSON.stringify({ database: process.env.DATABASE_URL, direct: process.env.DIRECT_URL }) + '\\n');
`,
        { mode: 0o755 },
      );
      const child = Bun.spawn(['sh', '-ec', script.replaceAll('$$', '$')], {
        env: { PATH: `${directory}:${process.env['PATH'] ?? ''}`, POSTGRES_PASSWORD: password },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      for (const line of output.trim().split('\n')) {
        const values = z
          .object({ database: z.string(), direct: z.string() })
          .parse(JSON.parse(line));
        const url = new URL(values.database);
        expect(decodeURIComponent(url.password)).toBe(password);
        expect(url.hostname).toBe(hostname);
        expect(url.pathname).toBe('/orbit');
        expect(values.direct).toBe(values.database);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
