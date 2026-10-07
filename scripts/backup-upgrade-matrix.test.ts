import { describe, expect, it } from 'bun:test';
import { parseMatrixArgs } from './backup/upgrade-matrix.ts';

describe('upgrade matrix CLI args', () => {
  it('parses default matrix arguments', () => {
    const args = parseMatrixArgs(['bun', 'scripts/backup/upgrade-matrix.ts']);
    expect(args.scenario).toBeUndefined();
    expect(args.json).toBe(false);
    expect(args.help).toBe(false);
  });

  it('parses explicit scenario, database url, and json flag', () => {
    const args = parseMatrixArgs([
      'bun',
      'scripts/backup/upgrade-matrix.ts',
      '--scenario=fresh_install',
      '--database-url=postgres://user:pass@localhost:5432/matrix_db',
      '--json',
    ]);

    expect(args.scenario).toBe('fresh_install');
    expect(args.databaseUrl).toBe('postgres://user:pass@localhost:5432/matrix_db');
    expect(args.json).toBe(true);
  });

  it('ignores invalid scenario string and leaves scenario undefined', () => {
    const args = parseMatrixArgs([
      'bun',
      'scripts/backup/upgrade-matrix.ts',
      '--scenario=invalid_scenario_id',
    ]);
    expect(args.scenario).toBeUndefined();
  });

  it('parses help flag correctly', () => {
    const args = parseMatrixArgs(['bun', 'scripts/backup/upgrade-matrix.ts', '-h']);
    expect(args.help).toBe(true);
  });

  it('emits json error and exits nonzero when database url is missing and --json is passed', () => {
    const env = {
      ...process.env,
      DATABASE_URL: '',
      DIRECT_URL: '',
    };
    const proc = Bun.spawnSync(['bun', 'scripts/backup/upgrade-matrix.ts', '--json'], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(1);
    const stderrText = proc.stderr.toString();
    const parsed = JSON.parse(stderrText) as { status: string; error: string };
    expect(parsed.status).toBe('error');
    expect(parsed.error).toContain('DATABASE_URL or DIRECT_URL is required');
  });
});
