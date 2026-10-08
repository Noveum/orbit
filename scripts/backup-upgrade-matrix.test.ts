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

  it('rejects invalid scenario string with an error', () => {
    expect(() =>
      parseMatrixArgs([
        'bun',
        'scripts/backup/upgrade-matrix.ts',
        '--scenario=invalid_scenario_id',
      ]),
    ).toThrow('Invalid upgrade scenario');
  });

  it('rejects --scenario flag when operand is missing', () => {
    expect(() =>
      parseMatrixArgs(['bun', 'scripts/backup/upgrade-matrix.ts', '--scenario']),
    ).toThrow('Missing operand for --scenario');
  });

  it('reads ORBIT_DRILL_DATABASE_URL when --database-url is omitted', () => {
    const prevDrill = process.env['ORBIT_DRILL_DATABASE_URL'];
    process.env['ORBIT_DRILL_DATABASE_URL'] =
      'postgres://user:pass@localhost:5432/drill_fallback_db';
    try {
      const args = parseMatrixArgs(['bun', 'scripts/backup/upgrade-matrix.ts']);
      expect(args.databaseUrl).toBe('postgres://user:pass@localhost:5432/drill_fallback_db');
    } finally {
      process.env['ORBIT_DRILL_DATABASE_URL'] = prevDrill;
    }
  });

  it('does not fall back to ambient DATABASE_URL', () => {
    const prevDrill = process.env['ORBIT_DRILL_DATABASE_URL'];
    const prevDb = process.env['DATABASE_URL'];
    delete process.env['ORBIT_DRILL_DATABASE_URL'];
    process.env['DATABASE_URL'] = 'postgres://user:pass@localhost:5432/production_db';
    try {
      const args = parseMatrixArgs(['bun', 'scripts/backup/upgrade-matrix.ts']);
      expect(args.databaseUrl).toBeUndefined();
    } finally {
      process.env['ORBIT_DRILL_DATABASE_URL'] = prevDrill;
      process.env['DATABASE_URL'] = prevDb;
    }
  });

  it('parses help flag correctly', () => {
    const args = parseMatrixArgs(['bun', 'scripts/backup/upgrade-matrix.ts', '-h']);
    expect(args.help).toBe(true);
  });

  it('emits json error and exits nonzero when database url is missing and --json is passed', () => {
    const env = {
      ...process.env,
      ORBIT_DRILL_DATABASE_URL: '',
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
    expect(parsed.error).toContain('Database connection URL is required');
  });

  it('emits json error and exits nonzero when confirm-destructive is missing for destructive scenario', () => {
    const env = {
      ...process.env,
      ORBIT_DRILL_CONFIRM_TARGET: '',
    };
    const proc = Bun.spawnSync(
      [
        'bun',
        'scripts/backup/upgrade-matrix.ts',
        '--database-url=postgres://localhost:5432/db',
        '--scenario=backup_restore',
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
