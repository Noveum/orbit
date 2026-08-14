import { describe, expect, it } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '../src/check-drift.ts');
const ROOT = resolve(import.meta.dir, '../../..');

async function runGuard(
  env: Record<string, string | undefined>,
  flags: readonly string[],
): Promise<{ code: number; out: string }> {
  const bare = await mkdtemp(join(tmpdir(), 'orbit-guard-'));
  const proc = Bun.spawn(['bun', SCRIPT, ...flags], {
    cwd: bare,
    env: { PATH: process.env['PATH'] ?? '', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
  return { code: await proc.exited, out };
}

describe('the deploy guard', () => {
  it('lets a build through when there is no database to check', async () => {
    const { code, out } = await runGuard({ DATABASE_URL: undefined }, ['--guard-deploy']);
    expect(code).toBe(0);
    expect(out).toContain('no database to check');
  }, 30_000);

  it('lets a build through when the database cannot be reached, saying so', async () => {
    const { code, out } = await runGuard(
      { DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:9/none' },
      ['--guard-deploy'],
    );
    expect(code).toBe(0);
    expect(out).toContain('went unchecked');
  }, 30_000);

  it('refuses a production build when there is no database to check', async () => {
    const { code, out } = await runGuard({ DATABASE_URL: undefined, VERCEL_ENV: 'production' }, [
      '--guard-deploy',
    ]);
    expect(code).toBe(1);
    expect(out).toContain('Production schema verification is required');
  }, 30_000);

  it('refuses a production build when the database cannot be reached', async () => {
    const { code, out } = await runGuard(
      {
        DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:9/none',
        VERCEL_ENV: 'production',
      },
      ['--guard-deploy'],
    );
    expect(code).toBe(1);
    expect(out).toContain('Production schema verification is required');
  }, 30_000);

  it('still refuses to run at all without a database when it is not guarding', async () => {
    const { code } = await runGuard({ DATABASE_URL: undefined }, []);
    expect(code).toBe(2);
  }, 30_000);

  it('blocks the actual web production build before Next runs when the database is unreachable', async () => {
    const proc = Bun.spawn(['bun', 'run', '--filter', '@orbit/web', 'build'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:9/none',
        VERCEL_ENV: 'production',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
    expect(await proc.exited).toBe(1);
    expect(out).toContain('Production schema verification is required');
    expect(out).not.toContain('Creating an optimized production build');
  }, 30_000);
});
