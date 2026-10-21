import { describe, expect, it } from 'bun:test';
import { runRecoveryDrill } from '../packages/services/src/backup/index.ts';

describe('recovery drill integration contract', () => {
  it('fails fast with validationFailed when database connection URL is empty', async () => {
    await expect(
      runRecoveryDrill({
        databaseUrl: '',
      }),
    ).rejects.toThrow('Target database connection URL is required for recovery drill.');
  });
});
