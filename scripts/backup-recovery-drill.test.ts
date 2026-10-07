import { describe, expect, it } from 'bun:test';
import { parseDrillArgs } from './backup/recovery-drill.ts';

describe('recovery drill CLI args', () => {
  it('parses default drill arguments', () => {
    const args = parseDrillArgs(['bun', 'scripts/backup/recovery-drill.ts']);
    expect(args.json).toBe(false);
    expect(args.skipRedis).toBe(false);
    expect(args.cleanDestination).toBe(false);
    expect(args.help).toBe(false);
  });

  it('parses explicit flags for destination, redis, encryption, and clean', () => {
    const args = parseDrillArgs([
      'bun',
      'scripts/backup/recovery-drill.ts',
      '--destination=/var/backups/drill',
      '--database-url=postgres://user:pass@localhost:5432/drill_db',
      '--encryption-key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '--redis-url=redis://localhost:6380',
      '--skip-redis',
      '--clean',
      '--json',
    ]);

    expect(args.destination).toContain('drill');
    expect(args.databaseUrl).toBe('postgres://user:pass@localhost:5432/drill_db');
    expect(args.encryptionKey).toHaveLength(64);
    expect(args.redisUrl).toBe('redis://localhost:6380');
    expect(args.skipRedis).toBe(true);
    expect(args.cleanDestination).toBe(true);
    expect(args.json).toBe(true);
  });

  it('parses help flag correctly', () => {
    const args = parseDrillArgs(['bun', 'scripts/backup/recovery-drill.ts', '--help']);
    expect(args.help).toBe(true);
  });

  it('emits json error and exits nonzero when database url is missing and --json is passed', () => {
    const env = {
      ...process.env,
      DATABASE_URL: '',
      DIRECT_URL: '',
    };
    const proc = Bun.spawnSync(['bun', 'scripts/backup/recovery-drill.ts', '--json'], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(1);
    const stderrText = proc.stderr.toString();
    const parsed = JSON.parse(stderrText) as { status: string; error: string };
    expect(parsed.status).toBe('error');
    expect(parsed.error).toContain(
      'Database connection URL is required via --database-url or ORBIT_DRILL_DATABASE_URL.',
    );
  });

  it('emits json error and exits nonzero when confirm-destructive is missing', () => {
    const env = {
      ...process.env,
      ORBIT_DRILL_CONFIRM_TARGET: '',
    };
    const proc = Bun.spawnSync(
      [
        'bun',
        'scripts/backup/recovery-drill.ts',
        '--database-url=postgres://localhost:5432/db',
        '--json',
      ],
      {
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    expect(proc.exitCode).toBe(1);
    const stderrText = proc.stderr.toString();
    const parsed = JSON.parse(stderrText) as { status: string; error: string };
    expect(parsed.status).toBe('error');
    expect(parsed.error).toContain('Destructive confirmation is required');
  });
});
