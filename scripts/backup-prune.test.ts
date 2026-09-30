import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePruneArgs } from './backup/prune.ts';

describe('backup prune CLI args', () => {
  it('parses default prune arguments', () => {
    const args = parsePruneArgs(['bun', 'scripts/backup/prune.ts']);
    expect(typeof args.destination).toBe('string');
    expect(args.cleanIncomplete).toBe(true);
    expect(args.dryRun).toBe(false);
    expect(args.json).toBe(false);
  });

  it('parses explicit retention flags and quotas', () => {
    const args = parsePruneArgs([
      'bun',
      'scripts/backup/prune.ts',
      '--destination',
      '/var/backups',
      '--keep-count=15',
      '--keep-days=7',
      '--keep-hourly=24',
      '--keep-daily=7',
      '--keep-weekly=4',
      '--keep-monthly=12',
      '--max-bytes=100GB',
      '--pinned=backup-1,backup-2',
      '--stale-alert-hours=48',
      '--dry-run',
      '--json',
    ]);

    expect(args.destination).toContain('backups');
    expect(args.keepCount).toBe(15);
    expect(args.keepDays).toBe(7);
    expect(args.keepHourly).toBe(24);
    expect(args.keepDaily).toBe(7);
    expect(args.keepWeekly).toBe(4);
    expect(args.keepMonthly).toBe(12);
    expect(args.maxTotalBytes).toBe(100 * 1024 * 1024 * 1024);
    expect(args.pinnedBackupIds).toEqual(['backup-1', 'backup-2']);
    expect(args.staleAlertHours).toBe(48);
    expect(args.dryRun).toBe(true);
    expect(args.json).toBe(true);
  });

  it('parses --no-clean-incomplete flag', () => {
    const args = parsePruneArgs(['bun', 'scripts/backup/prune.ts', '--no-clean-incomplete']);
    expect(args.cleanIncomplete).toBe(false);
  });

  it('executes prune CLI with dry-run and json flags successfully', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-cli-prune-'));
    try {
      const proc = Bun.spawnSync(
        ['bun', 'scripts/backup/prune.ts', '--destination', tempDir, '--dry-run', '--json'],
        {
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );

      expect(proc.exitCode).toBe(0);
      const stdout = proc.stdout.toString();
      const parsed = JSON.parse(stdout) as {
        status: string;
        evaluatedCount: number;
        dryRun: boolean;
      };
      expect(parsed.status).toBe('ok');
      expect(parsed.evaluatedCount).toBe(0);
      expect(parsed.dryRun).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
