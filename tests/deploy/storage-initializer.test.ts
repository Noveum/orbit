import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('storage initialization passes reserved password characters as a literal argument', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-storage-initializer-test-'));
  const log = join(directory, 'calls.jsonl');
  const password = 'test/with+reserved=characters?$(echo unsafe)';
  try {
    await writeFile(
      join(directory, 'mc'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
if (args.join(' ') === 'admin config get orbit api') process.stdout.write('api cors_allow_origin=https://orbit.example.test ');
`,
      { mode: 0o755 },
    );
    for (const command of ['touch', 'tail']) {
      await writeFile(join(directory, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    const child = Bun.spawn(['sh', resolve('deploy/docker/initialize-storage.sh')], {
      env: {
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        CALL_LOG: log,
        MINIO_PASSWORD: password,
        ORBIT_APP_URL: 'https://orbit.example.test',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await child.exited).toBe(0);
    const calls: unknown[] = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line): unknown => JSON.parse(line));
    expect(calls).toContainEqual([
      'alias',
      'set',
      'orbit',
      'http://storage:9000',
      'orbit',
      password,
      '--api',
      'S3v4',
    ]);
    expect(calls).toContainEqual(['mb', '--ignore-existing', 'orbit/orbit-uploads']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
