import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { randomUUIDv7 } from '@orbit/shared/utils';

const PACKAGE = fileURLToPath(new URL('../', import.meta.url));

async function runDatabaseTests(databaseUrl: string, explicit?: string) {
  const env: Record<string, string | undefined> = {
    PATH: process.env['PATH'],
    HOME: process.env['HOME'],
    TMPDIR: process.env['TMPDIR'],
    DATABASE_URL: databaseUrl,
    ORBIT_TEST_LANE: '',
  };
  if (explicit !== undefined) env['TEST_DATABASE_URL'] = explicit;
  const child = Bun.spawn(
    [
      'bun',
      'test',
      'tests/schema/index.test.ts',
      '--test-name-pattern',
      'exposes a sync id column',
    ],
    { cwd: PACKAGE, env, stdout: 'pipe', stderr: 'pipe' },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exit, output: stdout + stderr };
}

describe('database package test preload', () => {
  it.each([
    {
      name: 'remote ambient server',
      ambient: 'postgres://user:pass@db.example.invalid/orbit_test_db',
      explicit: undefined,
    },
    {
      name: 'remote explicit test server',
      ambient: 'postgres://orbit:orbit@127.0.0.1:5434/orbit',
      explicit: 'postgres://user:pass@db.example.invalid/orbit_test_db',
    },
    {
      name: 'explicit development database',
      ambient: 'postgres://orbit:orbit@127.0.0.1:5434/orbit',
      explicit: 'postgres://orbit:orbit@127.0.0.1:5434/orbit',
    },
    {
      name: 'bare test prefix',
      ambient: 'postgres://orbit:orbit@127.0.0.1:5434/orbit',
      explicit: 'postgres://orbit:orbit@127.0.0.1:5434/orbit_test',
    },
    { name: 'malformed ambient URL', ambient: 'not-a-database-url', explicit: undefined },
    { name: 'socket or inherited host', ambient: 'postgres:///orbit_test_db', explicit: undefined },
  ])('refuses $name before test bodies execute', async ({ ambient, explicit }) => {
    const result = await runDatabaseTests(ambient, explicit);
    expect(result.exit).not.toBe(0);
    expect(result.output).toContain('Refusing database tests');
    expect(result.output).not.toContain('(pass) sync schema');
  });
  it('runs an isolated local schema test after verifying its database identity', async () => {
    const candidate = process.env['DATABASE_URL'];
    if (candidate === undefined) throw new Error('Run with an explicit local test database.');
    const target = new URL(candidate);
    if (
      !(
        ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) &&
        target.pathname.startsWith('/orbit_test_')
      )
    )
      throw new Error('A local test database is required.');
    const result = await runDatabaseTests(candidate);
    expect(result.exit).toBe(0);
    expect(result.output).toContain('(pass) sync schema');
  });
  it('verifies the local database exists before running any test body', async () => {
    const candidate = process.env['DATABASE_URL'];
    if (candidate === undefined) throw new Error('Run with an explicit local test database.');
    const target = new URL(candidate);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
      throw new Error('A local test server is required.');
    target.pathname = `/orbit_test_preload_missing_${randomUUIDv7().replaceAll('-', '')}`;
    const result = await runDatabaseTests(target.toString());
    expect(result.exit).not.toBe(0);
    expect(result.output).toContain('does not exist');
    expect(result.output).not.toContain('(pass) sync schema');
  });
});
