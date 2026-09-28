import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { releaseDatabase } from '@orbit/db/migration-release';
import { resolveTestDatabaseUrl } from '../../../../scripts/test-env.ts';
import { verifyPreflight } from '../../src/backup/preflight.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));

describe('verifyPreflight', () => {
  it('succeeds against compatible live database', async () => {
    const databaseUrl = process.env['DATABASE_URL'] ?? resolveTestDatabaseUrl('orbit_test_svc');

    await releaseDatabase(databaseUrl, MIGRATIONS);

    const result = await verifyPreflight(databaseUrl, MIGRATIONS);
    expect(typeof result.databaseVersion).toBe('string');
    expect(result.databaseVersion.length).toBeGreaterThan(0);
    expect(Array.isArray(result.ledger)).toBe(true);
    expect(result.ledger.length).toBeGreaterThan(0);
  });

  it('rejects invalid or unreachable database', async () => {
    await expect(
      verifyPreflight('postgres://orbit:orbit@localhost:59999/non_existent_db'),
    ).rejects.toThrow();
  }, 10_000);
});
