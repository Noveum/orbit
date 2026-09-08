import { describe, expect, it } from 'bun:test';
import { verifyPreflight } from '../../src/backup/preflight.ts';

describe('verifyPreflight', () => {
  it('succeeds against compatible live database', async () => {
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined) return;

    const result = await verifyPreflight(databaseUrl);
    expect(typeof result.databaseVersion).toBe('string');
    expect(result.databaseVersion.length).toBeGreaterThan(0);
    expect(Array.isArray(result.ledger)).toBe(true);
    expect(result.ledger.length).toBeGreaterThan(0);
  });

  it('rejects invalid or unreachable database', async () => {
    await expect(
      verifyPreflight('postgres://orbit:orbit@localhost:59999/non_existent_db'),
    ).rejects.toThrow();
  });
});
