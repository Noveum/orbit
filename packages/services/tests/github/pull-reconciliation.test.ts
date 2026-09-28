import { describe, expect, it } from 'bun:test';
import {
  githubCheckHeadReconciliation,
  githubPullRequest,
  githubPullRequestCheckContext,
  githubPullRequestReconciliation,
  githubRepositorySync,
  integration,
  organization,
  user,
} from '@orbit/db/schema';
import { and, eq } from 'drizzle-orm';
import { applyGithubEvent } from '../../src/github/apply.ts';
import { reconcileNextGithubPullRequest } from '../../src/github/pull-reconciliation.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';

const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
const CONFLICT_SHA = '123456789abcdef0123456789abcdef012345678';
const NEWER_SHA = '23456789abcdef0123456789abcdef0123456789';
const PROVIDER_TIME = '2026-09-01T00:00:03.000Z';
const NOW = new Date('2026-09-01T00:00:10.000Z');

interface PullFixture {
  readonly organizationId: string;
  readonly repositorySyncId: string;
  readonly pullRequestId: string;
}

async function seedPull(tx: TestTransaction): Promise<PullFixture> {
  const suffix = crypto.randomUUID();
  const organizationId = `org_${suffix}`;
  const userId = `usr_${suffix}`;
  const integrationId = `int_${suffix}`;
  const repositorySyncId = `repo_${suffix}`;
  const pullRequestId = `pull_${suffix}`;
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
  await tx.insert(githubPullRequest).values({
    id: pullRequestId,
    organizationId,
    repositorySyncId,
    repositoryId: '99',
    repositoryName: 'acme/web',
    number: 7,
    nodeId: 'PR_node',
    title: 'Rework dashboard',
    url: 'https://github.com/acme/web/pull/7',
    headRef: 'feature',
    headSha: HEAD_SHA,
    headEpoch: 3,
    providerUpdatedAt: new Date(PROVIDER_TIME),
    checkStatus: 'failure',
    lastEventAt: new Date(PROVIDER_TIME),
  });
  return { organizationId, repositorySyncId, pullRequestId };
}

function pullRequestEvent(headSha: string, providerUpdatedAt: string, action = 'synchronize') {
  return {
    eventName: 'pull_request',
    body: {
      action,
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
        head: { ref: 'feature', sha: headSha },
        base: { ref: 'main' },
        user: { login: 'octocat', id: 500 },
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: providerUpdatedAt,
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'octocat', id: 500 },
    },
  } as const;
}

async function enqueueEqualTimeConflict(tx: TestTransaction, fixture: PullFixture) {
  await applyGithubEvent(tx, {
    ...pullRequestEvent(CONFLICT_SHA, PROVIDER_TIME),
    organizationId: fixture.organizationId,
    now: NOW,
  });
  const [job] = await tx
    .select()
    .from(githubPullRequestReconciliation)
    .where(eq(githubPullRequestReconciliation.pullRequestId, fixture.pullRequestId));
  if (job === undefined) throw new Error('pull request reconciliation fixture is missing');
  return job;
}

async function seedPendingReconciliation(tx: TestTransaction, fixture: PullFixture) {
  const id = `prr_${crypto.randomUUID()}`;
  await tx.insert(githubPullRequestReconciliation).values({
    id,
    organizationId: fixture.organizationId,
    repositorySyncId: fixture.repositorySyncId,
    pullRequestId: fixture.pullRequestId,
    status: 'pending',
    jobVersion: 1,
    capturedHeadEpoch: 3,
    conflictingHeadShas: [HEAD_SHA, CONFLICT_SHA],
    conflictingProviderUpdatedAt: new Date(PROVIDER_TIME),
    triggerIdentity: `trigger_${id}`,
    availableAt: NOW,
  });
  return id;
}

describe('reconcileNextGithubPullRequest', () => {
  it('corrects an equal-time head conflict from the authoritative pull request', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedPull(tx);
      const job = await enqueueEqualTimeConflict(tx, fixture);

      const result = await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchPullRequestHead: async () => ({
          number: 7,
          headSha: CONFLICT_SHA,
          providerUpdatedAt: PROVIDER_TIME,
        }),
      });

      expect(result).toMatchObject({
        status: 'accepted',
        reconciliationId: job.id,
        pullRequestId: fixture.pullRequestId,
        corrected: true,
      });
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.headSha).toBe(CONFLICT_SHA);
      expect(pull?.headEpoch).toBe(4);
      expect(pull?.checkStatus).toBe('unknown');
      const [completed] = await tx
        .select()
        .from(githubPullRequestReconciliation)
        .where(eq(githubPullRequestReconciliation.id, job.id));
      expect(completed?.status).toBe('completed');
      expect(completed?.resolvedHeadSha).toBe(CONFLICT_SHA);
    });
  });

  it('rejects a fetched head after a newer synchronize advances the pull epoch', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedPull(tx);
      await enqueueEqualTimeConflict(tx, fixture);

      const result = await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchPullRequestHead: async () => {
          await applyGithubEvent(tx, {
            ...pullRequestEvent(NEWER_SHA, '2026-09-01T00:00:04.000Z'),
            organizationId: fixture.organizationId,
            now: new Date('2026-09-01T00:00:11.000Z'),
          });
          return {
            number: 7,
            headSha: CONFLICT_SHA,
            providerUpdatedAt: PROVIDER_TIME,
          };
        },
      });

      expect(result.status).toBe('invalidated');
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.headSha).toBe(NEWER_SHA);
      expect(pull?.headEpoch).toBe(4);
      expect(pull?.providerUpdatedAt?.toISOString()).toBe('2026-09-01T00:00:04.000Z');
      const [job] = await tx
        .select()
        .from(githubPullRequestReconciliation)
        .where(eq(githubPullRequestReconciliation.pullRequestId, fixture.pullRequestId));
      expect(job?.status).toBe('completed');
      expect(job?.claimToken).toBeNull();
      expect(job?.resolvedHeadSha).toBe(NEWER_SHA);
    });
  });

  it('resolves an authoritative same-head response without advancing the epoch', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedPull(tx);
      const jobId = await seedPendingReconciliation(tx, fixture);

      const result = await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchPullRequestHead: async () => ({
          number: 7,
          headSha: HEAD_SHA,
          providerUpdatedAt: '2026-09-01T00:00:04.000Z',
        }),
      });

      expect(result).toMatchObject({ status: 'accepted', corrected: false });
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.headEpoch).toBe(3);
      expect(pull?.checkStatus).toBe('failure');
      const [job] = await tx
        .select()
        .from(githubPullRequestReconciliation)
        .where(eq(githubPullRequestReconciliation.id, jobId));
      expect(job?.status).toBe('completed');
      expect(job?.resolvedHeadSha).toBe(HEAD_SHA);
    });
  });

  it('keeps the current head when the provider snapshot is older', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedPull(tx);
      await seedPendingReconciliation(tx, fixture);

      const result = await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchPullRequestHead: async () => ({
          number: 7,
          headSha: CONFLICT_SHA,
          providerUpdatedAt: '2026-09-01T00:00:02.000Z',
        }),
      });

      expect(result.status).toBe('retry_scheduled');
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.headSha).toBe(HEAD_SHA);
      expect(pull?.headEpoch).toBe(3);
      const staleHeadJobs = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(
          and(
            eq(githubCheckHeadReconciliation.repositorySyncId, fixture.repositorySyncId),
            eq(githubCheckHeadReconciliation.headSha, CONFLICT_SHA),
          ),
        );
      expect(staleHeadJobs).toEqual([]);
    });
  });

  it('reclaims an expired claim with a fresh token and captured head epoch', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedPull(tx);
      const jobId = await seedPendingReconciliation(tx, fixture);
      const expiredToken = `expired_${crypto.randomUUID()}`;
      await tx
        .update(githubPullRequestReconciliation)
        .set({
          status: 'processing',
          attempts: 1,
          claimToken: expiredToken,
          claimedAt: new Date(NOW.getTime() - 60_000),
          leaseExpiresAt: new Date(NOW.getTime() - 1),
          claimedJobVersion: 1,
          claimedHeadEpoch: 3,
        })
        .where(eq(githubPullRequestReconciliation.id, jobId));
      let activeToken = '';

      const result = await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchPullRequestHead: async () => {
          const [claimed] = await tx
            .select()
            .from(githubPullRequestReconciliation)
            .where(eq(githubPullRequestReconciliation.id, jobId));
          activeToken = claimed?.claimToken ?? '';
          expect(claimed?.claimedHeadEpoch).toBe(3);
          expect(claimed?.claimedJobVersion).toBe(1);
          return { number: 7, headSha: HEAD_SHA, providerUpdatedAt: PROVIDER_TIME };
        },
      });

      expect(result.status).toBe('accepted');
      expect(activeToken).not.toBe('');
      expect(activeToken).not.toBe(expiredToken);
      const [job] = await tx
        .select()
        .from(githubPullRequestReconciliation)
        .where(eq(githubPullRequestReconciliation.id, jobId));
      expect(job?.attempts).toBe(2);
    });
  });

  it('rejects a provider result that returns after the active claim lease expires', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedPull(tx);
      const jobId = await seedPendingReconciliation(tx, fixture);
      const completedAt = new Date(NOW.getTime() + 30_001);
      let reads = 0;

      const result = await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: () => {
          reads += 1;
          return reads === 1 ? NOW : completedAt;
        },
        fetchPullRequestHead: async () => ({
          number: 7,
          headSha: CONFLICT_SHA,
          providerUpdatedAt: PROVIDER_TIME,
        }),
      });

      expect(result.status).toBe('retry_scheduled');
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, fixture.pullRequestId));
      expect(pull?.headSha).toBe(HEAD_SHA);
      expect(pull?.headEpoch).toBe(3);
      const [job] = await tx
        .select()
        .from(githubPullRequestReconciliation)
        .where(eq(githubPullRequestReconciliation.id, jobId));
      expect(job?.status).toBe('pending');
      expect(job?.lastError).toBe('claim_lease_expired');
    });
  });

  it('enqueues the authoritative head for check reconciliation after a correction', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedPull(tx);
      await enqueueEqualTimeConflict(tx, fixture);

      await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        fetchPullRequestHead: async () => ({
          number: 7,
          headSha: CONFLICT_SHA,
          providerUpdatedAt: PROVIDER_TIME,
        }),
      });

      const [headJob] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(
          and(
            eq(githubCheckHeadReconciliation.repositorySyncId, fixture.repositorySyncId),
            eq(githubCheckHeadReconciliation.headSha, CONFLICT_SHA),
          ),
        );
      expect(headJob?.status).toBe('pending');
      expect(headJob?.jobVersion).toBe(1);
      expect(headJob?.triggerKind).toBe('pull_request_head_reconciled');
      const currentProjections = await tx
        .select()
        .from(githubPullRequestCheckContext)
        .where(
          and(
            eq(githubPullRequestCheckContext.pullRequestId, fixture.pullRequestId),
            eq(githubPullRequestCheckContext.capturedHeadEpoch, 4),
          ),
        );
      expect(currentProjections).toEqual([]);
    });
  });

  it('uses bounded retries and stores a sanitized provider failure', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedPull(tx);
      const jobId = await seedPendingReconciliation(tx, fixture);

      const first = await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        retryBaseMs: 500,
        maxAttempts: 2,
        fetchPullRequestHead: () => Promise.reject(new Error('Bearer github_pat_secret-value')),
      });

      expect(first.status).toBe('retry_scheduled');
      const [pending] = await tx
        .select()
        .from(githubPullRequestReconciliation)
        .where(eq(githubPullRequestReconciliation.id, jobId));
      expect(pending?.availableAt.toISOString()).toBe('2026-09-01T00:00:10.500Z');
      expect(pending?.lastError).not.toContain('secret-value');
      const second = await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: new Date('2026-09-01T00:00:10.500Z'),
        retryBaseMs: 500,
        maxAttempts: 2,
        fetchPullRequestHead: () => Promise.reject(new Error('still unavailable')),
      });
      expect(second.status).toBe('failed');
    });
  });

  it('gives a fresh conflict job a fresh retry budget', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedPull(tx);
      const jobId = await seedPendingReconciliation(tx, fixture);
      await tx
        .update(githubPullRequestReconciliation)
        .set({ status: 'failed', attempts: 8 })
        .where(eq(githubPullRequestReconciliation.id, jobId));

      await applyGithubEvent(tx, {
        ...pullRequestEvent(CONFLICT_SHA, PROVIDER_TIME),
        organizationId: fixture.organizationId,
        now: NOW,
      });
      const [rearmed] = await tx
        .select()
        .from(githubPullRequestReconciliation)
        .where(eq(githubPullRequestReconciliation.id, jobId));
      expect(rearmed?.status).toBe('pending');
      expect(rearmed?.jobVersion).toBe(2);
      expect(rearmed?.attempts).toBe(0);

      const result = await reconcileNextGithubPullRequest(tx, {
        appId: 'app',
        privateKey: 'private-key',
        now: NOW,
        maxAttempts: 2,
        fetchPullRequestHead: () => Promise.reject(new Error('unavailable')),
      });
      expect(result.status).toBe('retry_scheduled');
    });
  });
});
