import { describe, expect, it } from 'bun:test';
import {
  runScenarioFreshInstall,
  runScenarioUnsafeRollbackRefusal,
  runUpgradeMatrix,
} from '../../src/backup/upgrade-matrix.ts';

describe('upgrade matrix scenarios', () => {
  it('applies every migration to a separate empty database even when the supplied target is current', async () => {
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.includes('test')) {
      throw new Error('An isolated test database is required.');
    }
    const result = await runScenarioFreshInstall(databaseUrl, undefined);
    expect(result.passed).toBe(true);
    expect(result.details?.['startedEmpty']).toBe(true);
    expect(result.details?.['appliedMigrations']).toBeGreaterThan(0);
    expect(result.details?.['appliedMigrations']).toBe(result.details?.['totalMigrations']);
  }, 120_000);

  it('proves scenario 3: explicitly refuses unsafe rollback and future format versions', async () => {
    const result = await runScenarioUnsafeRollbackRefusal(undefined);
    expect(result.id).toBe('unsafe_rollback_refusal');
    expect(result.passed).toBe(true);
    expect(result.details?.['refusalCaught']).toBe(true);
    expect(result.details?.['futureFormatCaught']).toBe(true);
  });

  it('runs filtered upgrade matrix targeting unsafe_rollback_refusal scenario', async () => {
    const result = await runUpgradeMatrix({
      databaseUrl: 'postgres://localhost:5432/mock_matrix',
      scenario: 'unsafe_rollback_refusal',
    });

    expect(result.allPassed).toBe(true);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]?.id).toBe('unsafe_rollback_refusal');
    expect(result.scenarios[0]?.passed).toBe(true);
    expect(typeof result.totalDurationMs).toBe('number');
  });
});
