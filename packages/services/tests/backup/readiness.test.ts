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
    const databaseUrl = resolveTestDatabaseUrl('orbit_test_svc');
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
    const databaseUrl = resolveTestDatabaseUrl('orbit_test_svc');
    const reachable = await isDatabaseReachable(databaseUrl);
    expect(reachable).toBe(true);

    await setRecoveryState(databaseUrl, 'ready');
    const lock = await acquireRestoreLock(databaseUrl);
    const state = await getRecoveryState(databaseUrl);
    expect(state?.status).toBe('restoring');

    await expect(acquireRestoreLock(databaseUrl)).rejects.toThrow(
      /Another restore operation is currently in progress/,
    );

    await lock.release();
    await setRecoveryState(databaseUrl, 'ready');
    const secondLock = await acquireRestoreLock(databaseUrl);
    await secondLock.release();
    await setRecoveryState(databaseUrl, 'ready');
  });

  it('allows safe retry after an interrupted restore process left status restoring', async () => {
    const databaseUrl = resolveTestDatabaseUrl('orbit_test_svc');
    const reachable = await isDatabaseReachable(databaseUrl);
    expect(reachable).toBe(true);

    await setRecoveryState(databaseUrl, 'restoring', 'interrupted');
    const state = await getRecoveryState(databaseUrl);
    expect(state?.status).toBe('restoring');

    const lock = await acquireRestoreLock(databaseUrl);
    try {
      const recoveredState = await getRecoveryState(databaseUrl);
      expect(recoveredState?.status).toBe('restoring');
      expect(recoveredState?.error).toBeNull();

      await expect(acquireRestoreLock(databaseUrl)).rejects.toThrow(
        /Another restore operation is currently in progress/,
      );
    } finally {
      await lock.release();
      await setRecoveryState(databaseUrl, 'ready');
    }
  });

  it('detects unexpected lock loss when lifetime timer closes the connection', async () => {
    const databaseUrl = resolveTestDatabaseUrl('orbit_test_svc');
    const reachable = await isDatabaseReachable(databaseUrl);
    expect(reachable).toBe(true);

    const lock = await acquireRestoreLock(databaseUrl, { maxLifetime: 1 });
    try {
      expect(lock.isLost()).toBe(false);
      expect(() => lock.assertActive()).not.toThrow();

      await new Promise((r) => setTimeout(r, 1600));

      expect(lock.isLost()).toBe(true);
      expect(() => lock.assertActive()).toThrow(/lost unexpectedly/);

      const secondLock = await acquireRestoreLock(databaseUrl);
      try {
        expect(secondLock.isLost()).toBe(false);
      } finally {
        await secondLock.release();
      }
    } finally {
      await lock.release();
      await setRecoveryState(databaseUrl, 'ready');
    }
  });
});
