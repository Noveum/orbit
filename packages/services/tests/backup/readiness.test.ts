import { describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { resolveTestDatabaseUrl } from '../../../../scripts/test-env.ts';
import {
  acquireRestoreLock,
  getRecoveryState,
  setRecoveryState,
} from '../../src/backup/readiness.ts';

async function isDatabaseReachable(url: string): Promise<boolean> {
  try {
    const sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 2 });
    try {
      await sql`select 1`;
      return true;
    } finally {
      await sql.end({ timeout: 2 });
    }
  } catch {
    return false;
  }
}

describe('readiness state management', () => {
  it('handles unreachable database by throwing or returning null', async () => {
    const unreachableUrl = 'postgres://orbit:orbit@localhost:59999/non_existent_db';
    await expect(getRecoveryState(unreachableUrl)).rejects.toThrow();
  }, 10_000);

  it('sets and retrieves recovery state when database is reachable', async () => {
    const databaseUrl = process.env['DATABASE_URL'] ?? resolveTestDatabaseUrl('orbit_test_svc');
    const reachable = await isDatabaseReachable(databaseUrl);
    expect(reachable).toBe(true);

    await setRecoveryState(databaseUrl, 'restoring');
    let state = await getRecoveryState(databaseUrl);
    expect(state?.status).toBe('restoring');
    expect(state?.error).toBeNull();

    await setRecoveryState(databaseUrl, 'validation_failed', 'referential integrity check failed');
    state = await getRecoveryState(databaseUrl);
    expect(state?.status).toBe('validation_failed');
    expect(state?.error).toBe('referential integrity check failed');

    await setRecoveryState(databaseUrl, 'ready');
    state = await getRecoveryState(databaseUrl);
    expect(state?.status).toBe('ready');
  });

  it('acquires restore lock exclusively and rejects concurrent restore attempts', async () => {
    const databaseUrl = process.env['DATABASE_URL'] ?? resolveTestDatabaseUrl('orbit_test_svc');
    const reachable = await isDatabaseReachable(databaseUrl);
    expect(reachable).toBe(true);

    await setRecoveryState(databaseUrl, 'ready');
    await acquireRestoreLock(databaseUrl);
    const state = await getRecoveryState(databaseUrl);
    expect(state?.status).toBe('restoring');

    await expect(acquireRestoreLock(databaseUrl)).rejects.toThrow(
      /Another restore operation is currently in progress/,
    );

    await setRecoveryState(databaseUrl, 'ready');
    await expect(acquireRestoreLock(databaseUrl)).resolves.toBeUndefined();
    await setRecoveryState(databaseUrl, 'ready');
  });
});
