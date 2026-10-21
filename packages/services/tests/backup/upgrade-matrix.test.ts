import { describe, expect, it } from 'bun:test';
import {
  runScenarioUnsafeRollbackRefusal,
  runUpgradeMatrix,
} from '../../src/backup/upgrade-matrix.ts';

describe('upgrade matrix scenarios', () => {
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
