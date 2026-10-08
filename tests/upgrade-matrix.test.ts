import { describe, expect, it } from 'bun:test';
import { runUpgradeMatrix } from '../packages/services/src/backup/index.ts';

describe('upgrade matrix integration contract', () => {
  it('proves scenario 3 downgrade and format refusal without live database', async () => {
    const result = await runUpgradeMatrix({
      databaseUrl: 'postgres://localhost:5432/mock_db',
      scenario: 'unsafe_rollback_refusal',
    });

    expect(result.allPassed).toBe(true);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]?.id).toBe('unsafe_rollback_refusal');
    expect(result.scenarios[0]?.passed).toBe(true);
  });
});
