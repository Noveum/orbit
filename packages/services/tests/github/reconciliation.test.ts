import { describe, expect, it } from 'bun:test';
import {
  account,
  githubCheckActivity,
  githubCheckHeadContext,
  githubCheckHeadReconciliation,
  githubCheckReconciliationFetch,
  githubPullRequest,
  githubPullRequestCheckContext,
  githubRepositorySync,
  integration,
  member,
  notification,
  notificationSourceEvent,
  organization,
  user,
  webhookDelivery,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { applyGithubEvent } from '../../src/github/apply.ts';
import { githubContextKey } from '../../src/github/checks.ts';
import { notifyGithubCheckFailureTransitions } from '../../src/github/notifications.ts';
import { reconcileNextGithubCheckHead } from '../../src/github/reconciliation.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';

const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
const NEXT_HEAD_SHA = '123456789abcdef0123456789abcdef012345678';
const NOW = new Date('2026-09-01T00:00:00.000Z');

async function seedReconciliation(
  tx: TestTransaction,
  input: { readonly withPull?: boolean } = {},
): Promise<{
  readonly organizationId: string;
  readonly repositorySyncId: string;
  readonly reconciliationId: string;
  readonly pullRequestId: string | null;
  readonly userId: string;
}> {
  const suffix = crypto.randomUUID();
  const organizationId = `org_${suffix}`;
  const userId = `usr_${suffix}`;
  const integrationId = `int_${suffix}`;
  const repositorySyncId = `repo_${suffix}`;
  const reconciliationId = `reconcile_${suffix}`;
  await tx.insert(organization).values({
    id: organizationId,
    name: 'Acme',
    slug: `acme-${suffix}`,
  });
  await tx.insert(user).values({
    id: userId,
    name: 'Owner',
    email: `${suffix}@orbit.local`,
    handle: `owner-${suffix}`,
  });
  await tx.insert(member).values({
    id: `member_${suffix}`,
    organizationId,
    userId,
    role: 'member',
  });
  await tx.insert(account).values({
    id: `account_${suffix}`,
    accountId: '500',
    providerId: 'github',
    userId,
  });
  await tx.insert(integration).values({
    id: integrationId,
    organizationId,
    provider: 'github',
    externalId: `installation-${suffix}`,
    connectedById: userId,
  });
  await tx.insert(githubRepositorySync).values({
    id: repositorySyncId,
    organizationId,
    integrationId,
    repositoryId: '99',
    repositoryName: 'acme/web',
    installationId: `installation-${suffix}`,
  });
  await tx.insert(githubCheckHeadReconciliation).values({
    id: reconciliationId,
    organizationId,
    repositorySyncId,
    headSha: HEAD_SHA,
    status: 'pending',
    jobVersion: 1,
    triggerKind: 'check_suite',
    triggerIdentity: `suite-${suffix}`,
    availableAt: NOW,
    settleDeadline: new Date(NOW.getTime() + 30_000),
  });
  if (input.withPull !== true) {
    return { organizationId, repositorySyncId, reconciliationId, pullRequestId: null, userId };
  }
  const pullRequestId = `pull_${suffix}`;
  await tx.insert(githubPullRequest).values({
    id: pullRequestId,
    organizationId,
    repositorySyncId,
    repositoryId: '99',
    repositoryName: 'acme/web',
    number: 7,
    title: 'Rework dashboard',
    url: 'https://github.com/acme/web/pull/7',
    headSha: HEAD_SHA,
    headEpoch: 2,
    checkStatus: 'pending',
    authorLogin: 'octocat',
    authorId: '500',
  });
  return { organizationId, repositorySyncId, reconciliationId, pullRequestId, userId };
}

function snapshot(
  contexts: readonly {
    readonly id: string;
    readonly name: string;
    readonly state: 'failure' | 'success' | 'pending' | 'unknown';
    readonly updatedAt?: string;
  }[],
) {
  const activities = contexts.map((context) => ({
    sourceKind: 'check_run' as const,
    contextKey: githubContextKey(['check_run', '10', context.name]),
    providerObjectId: context.id,
    providerRunId: context.id,
    providerContext: context.name,
    appId: 10,
    state: context.state,
    status: 'completed',
    conclusion: context.state,
    providerUpdatedAt: context.updatedAt ?? '2026-09-01T00:00:01.000Z',
    url: `https://github.com/acme/web/actions/runs/${context.id}`,
    creator: null,
  }));
  return { headSha: HEAD_SHA, activities, contexts: activities };
}

async function applyDirectCheck(
  tx: TestTransaction,
  organizationId: string,
  input: {
    readonly id: number;
    readonly state: 'failure' | 'success';
    readonly updatedAt: string;
  },
) {
  const webhookDeliveryId = `whd_${randomUUIDv7()}`;
  await tx.insert(webhookDelivery).values({
    id: webhookDeliveryId,
    provider: 'github',
    deliveryId: `delivery_${randomUUIDv7()}`,
    event: 'check_run',
    organizationId,
    status: 'processing',
  });
  return await applyGithubEvent(tx, {
    eventName: 'check_run',
    body: {
      action: 'completed',
      check_run: {
        id: input.id,
        name: 'verify',
        app: { id: 10 },
        status: 'completed',
        conclusion: input.state,
        html_url: `https://github.com/acme/web/actions/runs/${input.id}`,
        head_sha: HEAD_SHA,
        pull_requests: [{ number: 7 }],
        completed_at: input.updatedAt,
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'ci', id: 3 },
    },
    organizationId,
    webhookDeliveryId,
    now: NOW,
  });
}

async function applySuiteTrigger(tx: TestTransaction, organizationId: string, id: number) {
  return await applyGithubEvent(tx, {
    eventName: 'check_suite',
    body: {
      action: 'completed',
      check_suite: {
        id,
        conclusion: 'failure',
        head_sha: HEAD_SHA,
        pull_requests: [{ number: 7 }],
        updated_at: '2026-09-01T00:00:02.000Z',
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'ci', id: 3 },
    },
    organizationId,
    now: NOW,
  });
}

function pullRequestEvent() {
  return {
    eventName: 'pull_request',
    body: {
      action: 'opened',
      pull_request: {
        id: 7007,
        node_id: 'PR_node',
        number: 7,
        title: 'Rework dashboard',
        body: null,
        html_url: 'https://github.com/acme/web/pull/7',
        draft: false,
        merged: false,
        state: 'open',
        head: { ref: 'feature', sha: HEAD_SHA },
        base: { ref: 'main' },
        user: { login: 'octocat', id: 500 },
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:03.000Z',
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'octocat', id: 500 },
    },
  } as const;
}

describe('reconcileNextGithubCheckHead', () => {
  it('persists fetched provenance and projects an accepted snapshot to the current pull head', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx, { withPull: true });
      if (fixture.pullRequestId === null) throw new Error('pull request fixture is missing');

      const result = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => snapshot([{ id: '41', name: 'verify', state: 'failure' }]),
      });

      expect(result.status).toBe('accepted');
      expect(result.failureTransitions).toEqual([
        {
          organizationId: fixture.organizationId,
          repositorySyncId: fixture.repositorySyncId,
          pullRequestId: fixture.pullRequestId,
          headSha: HEAD_SHA,
          headEpoch: 2,
          previousStatus: 'pending',
          currentStatus: 'failure',
        },
      ]);
      const [head] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
      expect(head?.status).toBe('completed');
      expect(head?.contextGeneration).toBe(1);
      const fetched = await tx
        .select()
        .from(githubCheckReconciliationFetch)
        .where(eq(githubCheckReconciliationFetch.headReconciliationId, fixture.reconciliationId));
      expect(fetched).toHaveLength(1);
      expect(fetched[0]?.disposition).toBe('accepted');
      const activities = await tx
        .select()
        .from(githubCheckActivity)
        .where(eq(githubCheckActivity.reconciliationFetchId, fetched[0]?.id ?? 'missing'));
      expect(activities).toHaveLength(1);
      const contexts = await tx
        .select()
        .from(githubCheckHeadContext)
        .where(
          and(
            eq(githubCheckHeadContext.repositorySyncId, fixture.repositorySyncId),
            eq(githubCheckHeadContext.headSha, HEAD_SHA),
          ),
        );
      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.state).toBe('failure');
      const projections = await tx
        .select()
        .from(githubPullRequestCheckContext)
        .where(eq(githubPullRequestCheckContext.pullRequestId, fixture.pullRequestId));
      expect(projections).toHaveLength(1);
      expect(projections[0]?.projectedState).toBe('failure');
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.checkStatus).toBe('failure');
    });
  });

  it('persists failure fanout through the accepting reconciliation transaction', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx, { withPull: true });
      if (fixture.pullRequestId === null) throw new Error('pull request fixture is missing');
      const observed: {
        statusDuringFanout: string | null;
        transitionedPullRequestId: string | null;
      } = { statusDuringFanout: null, transitionedPullRequestId: null };

      const result = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => snapshot([{ id: '141', name: 'verify', state: 'failure' }]),
        acceptFailureTransitions: async (database, transitions) => {
          const [head] = await database
            .select({ status: githubCheckHeadReconciliation.status })
            .from(githubCheckHeadReconciliation)
            .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
          observed.statusDuringFanout = head?.status ?? null;
          observed.transitionedPullRequestId = transitions[0]?.pullRequestId ?? null;
        },
      });

      expect(result.status).toBe('accepted');
      expect(observed.statusDuringFanout).toBe('processing');
      expect(observed.transitionedPullRequestId).toBe(fixture.pullRequestId);
      const [head] = await tx
        .select({ status: githubCheckHeadReconciliation.status })
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
      expect(head?.status).toBe('completed');
    });
  });

  it('atomically fans out the coarse check failure source for an accepted snapshot', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx, { withPull: true });
      if (fixture.pullRequestId === null) throw new Error('pull request fixture is missing');

      const result = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => snapshot([{ id: '142', name: 'verify', state: 'failure' }]),
        acceptFailureTransitions: async (database, transitions) => {
          await notifyGithubCheckFailureTransitions(database, transitions, {
            now: NOW,
            slackEnabled: false,
          });
        },
      });

      expect(result.status).toBe('accepted');
      const sources = await tx
        .select()
        .from(notificationSourceEvent)
        .where(eq(notificationSourceEvent.organizationId, fixture.organizationId));
      expect(sources).toHaveLength(1);
      expect(sources[0]?.sourceEventKey).toBe(`github-pr:99:7:${HEAD_SHA}:checks-failed`);
      const recipients = await tx
        .select()
        .from(notification)
        .where(eq(notification.organizationId, fixture.organizationId));
      expect(recipients).toHaveLength(1);
      expect(recipients[0]?.userId).toBe(fixture.userId);
    });
  });

  it('keeps a direct context authoritative when it lands during a reconciliation fetch', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx, { withPull: true });
      if (fixture.pullRequestId === null) throw new Error('pull request fixture is missing');

      const result = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => {
          await applyDirectCheck(tx, fixture.organizationId, {
            id: 42,
            state: 'success',
            updatedAt: '2026-09-01T00:00:02.000Z',
          });
          return snapshot([
            {
              id: '41',
              name: 'verify',
              state: 'failure',
              updatedAt: '2026-09-01T00:00:01.000Z',
            },
          ]);
        },
      });

      expect(result.status).toBe('invalidated');
      expect(result.failureTransitions).toEqual([]);
      const contexts = await tx
        .select()
        .from(githubCheckHeadContext)
        .where(eq(githubCheckHeadContext.repositorySyncId, fixture.repositorySyncId));
      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.state).toBe('success');
      const attempts = await tx
        .select()
        .from(githubCheckReconciliationFetch)
        .where(eq(githubCheckReconciliationFetch.headReconciliationId, fixture.reconciliationId));
      expect(attempts[0]?.disposition).toBe('invalidated');
      const fetchedActivities = await tx
        .select()
        .from(githubCheckActivity)
        .where(eq(githubCheckActivity.reconciliationFetchId, attempts[0]?.id ?? 'missing'));
      expect(fetchedActivities).toHaveLength(1);
      expect(fetchedActivities[0]?.state).toBe('failure');
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.checkStatus).toBe('pending');

      const accepted = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: new Date(NOW.getTime() + 5_000),
        fetchSnapshot: async () =>
          snapshot([
            {
              id: '42',
              name: 'verify',
              state: 'success',
              updatedAt: '2026-09-01T00:00:02.000Z',
            },
          ]),
      });
      expect(accepted.status).toBe('accepted');
      const [authoritativePull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(authoritativePull?.checkStatus).toBe('success');
    });
  });

  it('re-arms the head when a new trigger arrives while a fetch is in flight', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx);

      const result = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => {
          await applySuiteTrigger(tx, fixture.organizationId, 82);
          return snapshot([{ id: '43', name: 'verify', state: 'success' }]);
        },
      });

      expect(result.status).toBe('invalidated');
      const [head] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
      expect(head?.status).toBe('pending');
      expect(head?.jobVersion).toBe(2);
      expect(head?.triggerIdentity).toBe('82');
      expect(head?.claimToken).toBeNull();
    });
  });

  it('retains a fetched response but invalidates it when the claim lease expires', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx, { withPull: true });
      if (fixture.pullRequestId === null) throw new Error('pull request fixture is missing');

      const result = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => {
          await tx
            .update(githubCheckHeadReconciliation)
            .set({ leaseExpiresAt: new Date(NOW.getTime() - 1) })
            .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
          return snapshot([{ id: '52', name: 'verify', state: 'failure' }]);
        },
      });

      expect(result.status).toBe('invalidated');
      expect(result.failureTransitions).toEqual([]);
      const [head] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
      expect(head?.status).toBe('pending');
      expect(head?.claimToken).toBeNull();
      const [attempt] = await tx
        .select()
        .from(githubCheckReconciliationFetch)
        .where(eq(githubCheckReconciliationFetch.headReconciliationId, fixture.reconciliationId));
      expect(attempt?.disposition).toBe('invalidated');
      const fetchedActivities = await tx
        .select()
        .from(githubCheckActivity)
        .where(eq(githubCheckActivity.reconciliationFetchId, attempt?.id ?? 'missing'));
      expect(fetchedActivities).toHaveLength(1);
      const contexts = await tx
        .select()
        .from(githubCheckHeadContext)
        .where(eq(githubCheckHeadContext.repositorySyncId, fixture.repositorySyncId));
      expect(contexts).toEqual([]);
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.checkStatus).toBe('pending');
    });
  });

  for (const abandonedDisposition of ['started', 'fetched'] as const) {
    it(`reclaims an expired ${abandonedDisposition} attempt with a new identity`, async () => {
      await withRollback(async (tx) => {
        const fixture = await seedReconciliation(tx);
        const oldAttemptId = `fetch_${randomUUIDv7()}`;
        const oldClaimToken = `claim_${randomUUIDv7()}`;
        await tx
          .update(githubCheckHeadReconciliation)
          .set({
            status: 'processing',
            attempts: 1,
            claimToken: oldClaimToken,
            claimedAt: new Date(NOW.getTime() - 60_000),
            leaseExpiresAt: new Date(NOW.getTime() - 1),
            claimedJobVersion: 1,
            claimedContextGeneration: 0,
          })
          .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
        await tx.insert(githubCheckReconciliationFetch).values({
          id: oldAttemptId,
          organizationId: fixture.organizationId,
          repositorySyncId: fixture.repositorySyncId,
          headSha: HEAD_SHA,
          headReconciliationId: fixture.reconciliationId,
          attemptNumber: 1,
          capturedJobVersion: 1,
          capturedContextGeneration: 0,
          claimToken: oldClaimToken,
          disposition: abandonedDisposition,
          requestedAt: new Date(NOW.getTime() - 60_000),
        });

        const result = await reconcileNextGithubCheckHead(tx, {
          appId: 'app',
          privateKey: 'private-key',
          now: NOW,
          fetchSnapshot: async () => snapshot([{ id: '44', name: 'verify', state: 'success' }]),
        });

        expect(result.status).toBe('accepted');
        expect(result.fetchAttemptId).not.toBe(oldAttemptId);
        const attempts = await tx
          .select()
          .from(githubCheckReconciliationFetch)
          .where(eq(githubCheckReconciliationFetch.headReconciliationId, fixture.reconciliationId));
        expect(attempts).toHaveLength(2);
        expect(attempts.find((attempt) => attempt.id === oldAttemptId)?.disposition).toBe(
          abandonedDisposition === 'started' ? 'abandoned' : 'invalidated',
        );
        expect(
          attempts.find((attempt) => attempt.id === result.fetchAttemptId)?.attemptNumber,
        ).toBe(2);
      });
    });
  }

  it('uses a new durable attempt when a failed fetch is retried', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx);
      const first = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: () => Promise.reject(new Error('provider unavailable')),
      });
      expect(first.status).toBe('retry_scheduled');

      const second = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: new Date(NOW.getTime() + 2_000),
        fetchSnapshot: async () => snapshot([{ id: '45', name: 'verify', state: 'success' }]),
      });

      expect(second.status).toBe('accepted');
      expect(second.fetchAttemptId).not.toBe(first.fetchAttemptId);
      const attempts = await tx
        .select()
        .from(githubCheckReconciliationFetch)
        .where(eq(githubCheckReconciliationFetch.headReconciliationId, fixture.reconciliationId));
      expect(attempts.map((attempt) => attempt.attemptNumber).sort()).toEqual([1, 2]);
      expect(attempts.map((attempt) => attempt.disposition).sort()).toEqual(['accepted', 'failed']);
    });
  });

  it('numbers fetch attempts within each job version', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx);
      const first = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => snapshot([{ id: '145', name: 'verify', state: 'success' }]),
      });
      expect(first.status).toBe('accepted');
      const nextNow = new Date(NOW.getTime() + 10_000);
      await tx
        .update(githubCheckHeadReconciliation)
        .set({
          status: 'pending',
          jobVersion: 2,
          attempts: 0,
          availableAt: nextNow,
          settleDeadline: null,
        })
        .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));

      const second = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: nextNow,
        fetchSnapshot: async () =>
          snapshot([
            {
              id: '146',
              name: 'verify',
              state: 'success',
              updatedAt: '2026-09-01T00:00:11.000Z',
            },
          ]),
      });

      expect(second.status).toBe('accepted');
      const attempts = await tx
        .select({
          jobVersion: githubCheckReconciliationFetch.capturedJobVersion,
          attemptNumber: githubCheckReconciliationFetch.attemptNumber,
        })
        .from(githubCheckReconciliationFetch)
        .where(eq(githubCheckReconciliationFetch.headReconciliationId, fixture.reconciliationId))
        .orderBy(asc(githubCheckReconciliationFetch.capturedJobVersion));
      expect(attempts).toEqual([
        { jobVersion: 1, attemptNumber: 1 },
        { jobVersion: 2, attemptNumber: 1 },
      ]);
    });
  });

  it('rearms a newer trigger when the superseded fetch fails on its last attempt', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx);
      await tx
        .update(githubCheckHeadReconciliation)
        .set({ attempts: 7 })
        .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));

      const failed = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => {
          await applySuiteTrigger(tx, fixture.organizationId, 147);
          throw new Error('superseded provider failure');
        },
      });

      expect(failed.status).toBe('retry_scheduled');
      const [rearmed] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
      expect(rearmed?.status).toBe('pending');
      expect(rearmed?.jobVersion).toBe(2);
      expect(rearmed?.attempts).toBe(0);
      expect(rearmed?.triggerIdentity).toBe('147');
      expect(rearmed?.lastError).toBeNull();

      const accepted = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => snapshot([{ id: '148', name: 'verify', state: 'success' }]),
      });
      expect(accepted.status).toBe('accepted');
    });
  });

  it('leases a head long enough for the bounded provider snapshot', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx);
      let leaseDurationMs = 0;

      const result = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => {
          const [head] = await tx
            .select({ leaseExpiresAt: githubCheckHeadReconciliation.leaseExpiresAt })
            .from(githubCheckHeadReconciliation)
            .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
          leaseDurationMs = (head?.leaseExpiresAt?.getTime() ?? NOW.getTime()) - NOW.getTime();
          return snapshot([{ id: '147', name: 'verify', state: 'success' }]);
        },
      });

      expect(result.status).toBe('accepted');
      expect(leaseDurationMs).toBeGreaterThanOrEqual(120_000);
    });
  });

  it('supersedes a missing context and removes its current pull projection', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx, { withPull: true });
      if (fixture.pullRequestId === null) throw new Error('pull request fixture is missing');
      const first = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () =>
          snapshot([
            { id: '46', name: 'verify', state: 'success' },
            { id: '47', name: 'security', state: 'failure' },
          ]),
      });
      expect(first.status).toBe('accepted');
      const nextNow = new Date(NOW.getTime() + 10_000);
      await tx
        .update(githubCheckHeadReconciliation)
        .set({ status: 'pending', jobVersion: 2, availableAt: nextNow })
        .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));

      const second = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: nextNow,
        fetchSnapshot: async () =>
          snapshot([
            {
              id: '48',
              name: 'verify',
              state: 'success',
              updatedAt: '2026-09-01T00:00:11.000Z',
            },
          ]),
      });

      expect(second.status).toBe('accepted');
      const contexts = await tx
        .select()
        .from(githubCheckHeadContext)
        .where(eq(githubCheckHeadContext.repositorySyncId, fixture.repositorySyncId));
      expect(contexts.find((context) => context.contextKey.includes('security'))?.active).toBe(
        false,
      );
      const projections = await tx
        .select()
        .from(githubPullRequestCheckContext)
        .where(eq(githubPullRequestCheckContext.pullRequestId, fixture.pullRequestId));
      expect(projections).toHaveLength(1);
      expect(projections[0]?.contextKey).toContain('verify');
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.checkStatus).toBe('success');
    });
  });

  it('does not project an accepted snapshot onto a pull that moved to another head', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx, { withPull: true });
      if (fixture.pullRequestId === null) throw new Error('pull request fixture is missing');
      await tx
        .update(githubPullRequest)
        .set({ headSha: NEXT_HEAD_SHA, headEpoch: 3, checkStatus: 'unknown' })
        .where(eq(githubPullRequest.id, fixture.pullRequestId));

      const result = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => snapshot([{ id: '49', name: 'verify', state: 'failure' }]),
      });

      expect(result.status).toBe('accepted');
      expect(result.failureTransitions).toEqual([]);
      const projections = await tx
        .select()
        .from(githubPullRequestCheckContext)
        .where(eq(githubPullRequestCheckContext.pullRequestId, fixture.pullRequestId));
      expect(projections).toEqual([]);
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.headSha).toBe(NEXT_HEAD_SHA);
      expect(pull?.checkStatus).toBe('unknown');
    });
  });

  it('projects a shared head to each pull with its own captured epoch', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx, { withPull: true });
      if (fixture.pullRequestId === null) throw new Error('pull request fixture is missing');
      const secondPullId = `pull_${randomUUIDv7()}`;
      await tx.insert(githubPullRequest).values({
        id: secondPullId,
        organizationId: fixture.organizationId,
        repositorySyncId: fixture.repositorySyncId,
        repositoryId: '99',
        repositoryName: 'acme/web',
        number: 8,
        title: 'Second pull',
        url: 'https://github.com/acme/web/pull/8',
        headSha: HEAD_SHA,
        headEpoch: 5,
        checkStatus: 'success',
      });

      const result = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => snapshot([{ id: '50', name: 'verify', state: 'failure' }]),
      });

      expect(result.status).toBe('accepted');
      expect(
        result.failureTransitions.map((transition) => transition.pullRequestId).sort(),
      ).toEqual([fixture.pullRequestId, secondPullId].sort());
      const projections = await tx
        .select()
        .from(githubPullRequestCheckContext)
        .where(
          inArray(githubPullRequestCheckContext.pullRequestId, [
            fixture.pullRequestId,
            secondPullId,
          ]),
        );
      expect(projections.map((projection) => projection.capturedHeadEpoch).sort()).toEqual([2, 5]);
    });
  });

  it('binds an accepted no-pull snapshot when the pull arrives later', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx);
      const reconciled = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => snapshot([{ id: '51', name: 'verify', state: 'failure' }]),
      });
      expect(reconciled.status).toBe('accepted');
      expect(reconciled.failureTransitions).toEqual([]);

      const applied = await applyGithubEvent(tx, {
        ...pullRequestEvent(),
        organizationId: fixture.organizationId,
        now: new Date(NOW.getTime() + 3_000),
      });

      expect(applied.pullRequests).toHaveLength(1);
      expect(applied.pullRequests[0]?.checkStatus).toBe('failure');
      expect(applied.notificationEvents.some((event) => event.type === 'pr_checks_failed')).toBe(
        true,
      );
    });
  });

  it('retries an empty snapshot until the settle deadline and then accepts explicit empty', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedReconciliation(tx);
      const empty = { headSha: HEAD_SHA, activities: [], contexts: [] };
      const first = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchSnapshot: async () => empty,
      });
      expect(first.status).toBe('retry_scheduled');
      const afterDeadline = new Date(NOW.getTime() + 31_000);
      const second = await reconcileNextGithubCheckHead(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: afterDeadline,
        fetchSnapshot: async () => empty,
      });

      expect(second.status).toBe('accepted');
      const [head] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.id, fixture.reconciliationId));
      expect(head?.status).toBe('completed');
      expect(head?.latestSnapshot).toEqual([]);
    });
  });
});
