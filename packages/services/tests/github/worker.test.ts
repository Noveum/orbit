import { describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { reconcilePendingGithubWork } from '../../src/github/worker.ts';
import { withRollback } from '../../src/test-database.ts';

describe('reconcilePendingGithubWork', () => {
  it('alternates bounded check-head and pull-head jobs until both queues are idle', async () => {
    await withRollback(async (tx) => {
      const calls: string[] = [];
      let checkCalls = 0;
      let pullCalls = 0;

      const result = await reconcilePendingGithubWork(tx, {
        appId: 'app',
        privateKey: 'private-key',
        limit: 10,
        reconcileCheckHead: () => {
          calls.push('check');
          checkCalls += 1;
          return Promise.resolve(
            checkCalls === 1
              ? {
                  status: 'accepted',
                  reconciliationId: 'check-1',
                  fetchAttemptId: 'fetch-1',
                  failureTransitions: [],
                }
              : {
                  status: 'idle',
                  reconciliationId: null,
                  fetchAttemptId: null,
                  failureTransitions: [],
                },
          );
        },
        reconcilePullRequest: () => {
          calls.push('pull');
          pullCalls += 1;
          return Promise.resolve(
            pullCalls === 1
              ? {
                  status: 'retry_scheduled',
                  reconciliationId: 'pull-job-1',
                  pullRequestId: 'pull-1',
                  corrected: false,
                }
              : {
                  status: 'idle',
                  reconciliationId: null,
                  pullRequestId: null,
                  corrected: false,
                },
          );
        },
      });

      expect(calls).toEqual(['check', 'pull', 'check', 'pull']);
      expect(result).toEqual({
        processed: 2,
        checkHeads: 1,
        pullRequests: 1,
        accepted: 1,
        retryScheduled: 1,
        failed: 0,
        actions: [],
      });
    });
  });

  it('returns the realtime actions created by accepted failure fanout', async () => {
    await withRollback(async (tx) => {
      const action: SyncAction = {
        syncId: 41,
        organizationId: 'org-1',
        scopes: ['user:user-1'],
        action: 'insert',
        model: 'notification',
        modelId: 'notification-1',
        data: { title: 'Checks failed' },
        actor: { type: 'integration', id: 'github', name: 'GitHub' },
        at: '2026-09-01T00:00:00.000Z',
      };
      const result = await reconcilePendingGithubWork(tx, {
        appId: 'app',
        privateKey: 'private-key',
        limit: 1,
        reconcileCheckHead: async (database, input) => {
          await input.acceptFailureTransitions?.(database, [
            {
              organizationId: 'org-1',
              repositorySyncId: 'repo-1',
              pullRequestId: 'pull-1',
              headSha: '0123456789abcdef0123456789abcdef01234567',
              headEpoch: 1,
              previousStatus: 'success',
              currentStatus: 'failure',
            },
          ]);
          return {
            status: 'accepted',
            reconciliationId: 'check-1',
            fetchAttemptId: 'fetch-1',
            failureTransitions: [],
          };
        },
        notifyCheckFailureTransitions: () =>
          Promise.resolve({
            notifications: [],
            actions: [action],
            email: [],
            slack: [],
            slackDm: [],
            deduped: 0,
          }),
      });

      expect(result.actions).toEqual([action]);
    });
  });

  it('stops at the shared job limit without draining one queue ahead of the other', async () => {
    await withRollback(async (tx) => {
      const calls: string[] = [];
      const result = await reconcilePendingGithubWork(tx, {
        appId: 'app',
        privateKey: 'private-key',
        limit: 2,
        reconcileCheckHead: () => {
          calls.push('check');
          return Promise.resolve({
            status: 'failed',
            reconciliationId: 'check-1',
            fetchAttemptId: 'fetch-1',
            failureTransitions: [],
          });
        },
        reconcilePullRequest: () => {
          calls.push('pull');
          return Promise.resolve({
            status: 'unavailable',
            reconciliationId: 'pull-job-1',
            pullRequestId: 'pull-1',
            corrected: false,
          });
        },
      });

      expect(calls).toEqual(['check', 'pull']);
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(2);
    });
  });
});
