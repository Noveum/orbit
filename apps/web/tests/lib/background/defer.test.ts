import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { registerDurableWork, runDeferredWork } from '../../../src/lib/background/defer.ts';
import {
  type DeferredWork,
  deferredWorkKey,
  deferredWorkSchema,
} from '../../../src/lib/background/work.ts';

const BACKFILL: DeferredWork = { kind: 'pull-request-backfill', organizationId: 'org_1' };
const HISTORY: DeferredWork = {
  kind: 'pull-request-history',
  organizationId: 'org_1',
  userId: 'user_1',
  pullRequestId: 'pull_1',
};

afterEach(() => {
  registerDurableWork(undefined);
});

describe('deferred work', () => {
  it('runs with the request when no durable runner is registered', async () => {
    const performed: DeferredWork[] = [];
    await runDeferredWork(BACKFILL, (work) => {
      performed.push(work);
      return Promise.resolve();
    });
    expect(performed).toEqual([BACKFILL]);
  });

  it('hands the work to the durable runner instead of running it with the request', async () => {
    const handed: DeferredWork[] = [];
    const performed: DeferredWork[] = [];
    registerDurableWork((work) => {
      handed.push(work);
      return Promise.resolve();
    });
    await runDeferredWork(HISTORY, (work) => {
      performed.push(work);
      return Promise.resolve();
    });
    expect(handed).toEqual([HISTORY]);
    expect(performed).toEqual([]);
  });

  it('falls back to running with the request when the durable runner refuses the work', async () => {
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    const performed: DeferredWork[] = [];
    registerDurableWork(() => Promise.reject(new Error('the object is unreachable')));
    await runDeferredWork(BACKFILL, (work) => {
      performed.push(work);
      return Promise.resolve();
    });
    expect(performed).toEqual([BACKFILL]);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it('logs a failure instead of rejecting, because nothing awaits background work', async () => {
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      runDeferredWork(BACKFILL, () => Promise.reject(new Error('GitHub is down'))),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it('keys a backfill by workspace and a history refresh by pull request', () => {
    expect(deferredWorkKey(BACKFILL)).toBe('pull-request-backfill:org_1');
    expect(deferredWorkKey(HISTORY)).toBe('pull-request-history:org_1:pull_1');
  });

  it('refuses work it does not know how to run', () => {
    expect(deferredWorkSchema.safeParse({ kind: 'drop-tables' }).success).toBe(false);
    expect(
      deferredWorkSchema.safeParse({ kind: 'pull-request-backfill', organizationId: '' }).success,
    ).toBe(false);
  });
});
