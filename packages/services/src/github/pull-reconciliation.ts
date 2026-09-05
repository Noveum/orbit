import type { Database, Transaction } from '@orbit/db';
import {
  githubCheckHeadReconciliation,
  githubPullRequest,
  githubPullRequestReconciliation,
  githubRepositorySync,
  nextSyncId,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, asc, eq, lte, or } from 'drizzle-orm';
import {
  fetchGithubPullRequestHead as fetchGithubPullRequestHeadFromProvider,
  type GithubAppRequest,
  type GithubPullRequestHead,
} from './app.ts';

type GithubPullReconciliationDatabase = Database | Transaction;

export type GithubPullRequestHeadFetcher = (
  input: GithubAppRequest & {
    readonly repository: string;
    readonly pullRequestNumber: number;
  },
) => Promise<GithubPullRequestHead>;

export interface ReconcileNextGithubPullRequestInput {
  readonly appId: string;
  readonly privateKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBase?: string;
  readonly organizationId?: string;
  readonly now?: Date | (() => Date);
  readonly leaseMs?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
  readonly maxAttempts?: number;
  readonly fetchPullRequestHead?: GithubPullRequestHeadFetcher;
}

export interface GithubPullRequestReconciliationResult {
  readonly status:
    | 'idle'
    | 'accepted'
    | 'invalidated'
    | 'retry_scheduled'
    | 'failed'
    | 'unavailable';
  readonly reconciliationId: string | null;
  readonly pullRequestId: string | null;
  readonly corrected: boolean;
}

interface ClaimedPullRequest {
  readonly reconciliationId: string;
  readonly organizationId: string;
  readonly repositorySyncId: string;
  readonly repositoryName: string;
  readonly installationId: string;
  readonly pullRequestId: string;
  readonly pullRequestNumber: number;
  readonly claimToken: string;
  readonly capturedJobVersion: number;
  readonly capturedHeadEpoch: number;
  readonly attemptNumber: number;
}

type ClaimResult =
  | { readonly kind: 'claimed'; readonly claim: ClaimedPullRequest }
  | { readonly kind: 'finished'; readonly result: GithubPullRequestReconciliationResult }
  | { readonly kind: 'idle' };

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 8;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function result(
  status: GithubPullRequestReconciliationResult['status'],
  values: {
    readonly reconciliationId?: string | null;
    readonly pullRequestId?: string | null;
    readonly corrected?: boolean;
  } = {},
): GithubPullRequestReconciliationResult {
  return {
    status,
    reconciliationId: values.reconciliationId ?? null,
    pullRequestId: values.pullRequestId ?? null,
    corrected: values.corrected ?? false,
  };
}

async function atomic<T>(
  database: GithubPullReconciliationDatabase,
  operation: (tx: GithubPullReconciliationDatabase) => Promise<T>,
): Promise<T> {
  if ('$client' in database) return await database.transaction(operation);
  return await operation(database);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return fallback;
  return value;
}

function currentTime(value: ReconcileNextGithubPullRequestInput['now']): Date {
  if (typeof value === 'function') return value();
  return value ?? new Date();
}

function retryAt(
  now: Date,
  attemptNumber: number,
  input: ReconcileNextGithubPullRequestInput,
): Date {
  const base = positiveInteger(input.retryBaseMs, DEFAULT_RETRY_BASE_MS);
  const maximum = positiveInteger(input.retryMaxMs, DEFAULT_RETRY_MAX_MS);
  const multiplier = 2 ** Math.min(Math.max(attemptNumber - 1, 0), 20);
  return new Date(now.getTime() + Math.min(maximum, base * multiplier));
}

function clearClaim() {
  return {
    claimToken: null,
    claimedAt: null,
    leaseExpiresAt: null,
    claimedJobVersion: null,
    claimedHeadEpoch: null,
  };
}

async function claimNextPullRequest(
  database: GithubPullReconciliationDatabase,
  input: ReconcileNextGithubPullRequestInput,
  now: Date,
): Promise<ClaimResult> {
  const [candidate] = await database
    .select({
      id: githubPullRequestReconciliation.id,
      organizationId: githubPullRequestReconciliation.organizationId,
      repositorySyncId: githubPullRequestReconciliation.repositorySyncId,
      pullRequestId: githubPullRequestReconciliation.pullRequestId,
    })
    .from(githubPullRequestReconciliation)
    .where(
      and(
        input.organizationId === undefined
          ? undefined
          : eq(githubPullRequestReconciliation.organizationId, input.organizationId),
        or(
          and(
            eq(githubPullRequestReconciliation.status, 'pending'),
            lte(githubPullRequestReconciliation.availableAt, now),
          ),
          and(
            eq(githubPullRequestReconciliation.status, 'processing'),
            lte(githubPullRequestReconciliation.leaseExpiresAt, now),
          ),
        ),
      ),
    )
    .orderBy(
      asc(githubPullRequestReconciliation.availableAt),
      asc(githubPullRequestReconciliation.id),
    )
    .limit(1);
  if (candidate === undefined) return { kind: 'idle' };
  const [repository] = await database
    .select()
    .from(githubRepositorySync)
    .where(
      and(
        eq(githubRepositorySync.organizationId, candidate.organizationId),
        eq(githubRepositorySync.id, candidate.repositorySyncId),
      ),
    )
    .limit(1)
    .for('update');
  if (repository === undefined) return { kind: 'idle' };
  const [pull] = await database
    .select()
    .from(githubPullRequest)
    .where(
      and(
        eq(githubPullRequest.organizationId, candidate.organizationId),
        eq(githubPullRequest.repositorySyncId, candidate.repositorySyncId),
        eq(githubPullRequest.id, candidate.pullRequestId),
      ),
    )
    .limit(1)
    .for('update');
  if (pull === undefined) return { kind: 'idle' };
  const [job] = await database
    .select()
    .from(githubPullRequestReconciliation)
    .where(eq(githubPullRequestReconciliation.id, candidate.id))
    .limit(1)
    .for('update');
  if (job === undefined) return { kind: 'idle' };
  const claimable =
    (job.status === 'pending' && job.availableAt.getTime() <= now.getTime()) ||
    (job.status === 'processing' &&
      job.leaseExpiresAt !== null &&
      job.leaseExpiresAt.getTime() <= now.getTime());
  if (!claimable) return { kind: 'idle' };
  if (job.capturedHeadEpoch !== pull.headEpoch) {
    await database
      .update(githubPullRequestReconciliation)
      .set({
        status: 'completed',
        resolvedHeadSha: pull.headSha,
        resolvedProviderUpdatedAt: pull.providerUpdatedAt,
        lastError: null,
        ...clearClaim(),
        updatedAt: now,
      })
      .where(eq(githubPullRequestReconciliation.id, job.id));
    return {
      kind: 'finished',
      result: result('invalidated', {
        reconciliationId: job.id,
        pullRequestId: pull.id,
      }),
    };
  }
  if (!repository.enabled || repository.installationId.length === 0) {
    await database
      .update(githubPullRequestReconciliation)
      .set({
        status: 'unavailable',
        lastError: 'github_repository_unavailable',
        ...clearClaim(),
        updatedAt: now,
      })
      .where(eq(githubPullRequestReconciliation.id, job.id));
    return {
      kind: 'finished',
      result: result('unavailable', {
        reconciliationId: job.id,
        pullRequestId: pull.id,
      }),
    };
  }
  const claimToken = randomUUIDv7();
  const attemptNumber = job.attempts + 1;
  const leaseExpiresAt = new Date(now.getTime() + positiveInteger(input.leaseMs, DEFAULT_LEASE_MS));
  const [claimed] = await database
    .update(githubPullRequestReconciliation)
    .set({
      status: 'processing',
      attempts: attemptNumber,
      claimToken,
      claimedAt: now,
      leaseExpiresAt,
      claimedJobVersion: job.jobVersion,
      claimedHeadEpoch: pull.headEpoch,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(githubPullRequestReconciliation.id, job.id))
    .returning();
  if (claimed === undefined) return { kind: 'idle' };
  return {
    kind: 'claimed',
    claim: {
      reconciliationId: job.id,
      organizationId: job.organizationId,
      repositorySyncId: job.repositorySyncId,
      repositoryName: repository.repositoryName,
      installationId: repository.installationId,
      pullRequestId: pull.id,
      pullRequestNumber: pull.number,
      claimToken,
      capturedJobVersion: job.jobVersion,
      capturedHeadEpoch: pull.headEpoch,
      attemptNumber,
    },
  };
}

type PullRequestReconciliationRow = typeof githubPullRequestReconciliation.$inferSelect;
type PullRequestRow = typeof githubPullRequest.$inferSelect;

function claimOwnsJob(
  claim: ClaimedPullRequest,
  pull: PullRequestRow,
  job: PullRequestReconciliationRow,
): boolean {
  return (
    job.status === 'processing' &&
    job.claimToken === claim.claimToken &&
    job.jobVersion === claim.capturedJobVersion &&
    job.claimedJobVersion === claim.capturedJobVersion &&
    job.claimedHeadEpoch === claim.capturedHeadEpoch &&
    job.capturedHeadEpoch === claim.capturedHeadEpoch &&
    pull.headEpoch === claim.capturedHeadEpoch
  );
}

async function markClaimFailure(
  database: GithubPullReconciliationDatabase,
  claim: ClaimedPullRequest,
  input: ReconcileNextGithubPullRequestInput,
  now: Date,
  failure: string,
): Promise<GithubPullRequestReconciliationResult> {
  return await atomic(database, async (tx) => {
    const [repository] = await tx
      .select({ id: githubRepositorySync.id })
      .from(githubRepositorySync)
      .where(eq(githubRepositorySync.id, claim.repositorySyncId))
      .limit(1)
      .for('update');
    if (repository === undefined) return result('invalidated');
    const [pull] = await tx
      .select()
      .from(githubPullRequest)
      .where(eq(githubPullRequest.id, claim.pullRequestId))
      .limit(1)
      .for('update');
    if (pull === undefined) return result('invalidated');
    const [job] = await tx
      .select()
      .from(githubPullRequestReconciliation)
      .where(eq(githubPullRequestReconciliation.id, claim.reconciliationId))
      .limit(1)
      .for('update');
    if (job === undefined || !claimOwnsJob(claim, pull, job)) {
      if (job !== undefined) await resolveSupersededClaim(tx, claim, pull, job, now);
      return result('invalidated', {
        reconciliationId: claim.reconciliationId,
        pullRequestId: claim.pullRequestId,
      });
    }
    const exhausted =
      claim.attemptNumber >= positiveInteger(input.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    await tx
      .update(githubPullRequestReconciliation)
      .set({
        status: exhausted ? 'failed' : 'pending',
        availableAt: retryAt(now, claim.attemptNumber, input),
        lastError: failure,
        ...clearClaim(),
        updatedAt: now,
      })
      .where(eq(githubPullRequestReconciliation.id, job.id));
    return result(exhausted ? 'failed' : 'retry_scheduled', {
      reconciliationId: job.id,
      pullRequestId: pull.id,
    });
  });
}

async function lockedHeadJob(
  database: GithubPullReconciliationDatabase,
  context: {
    readonly organizationId: string;
    readonly repositorySyncId: string;
    readonly headSha: string;
    readonly pullRequestNumber: number;
    readonly headEpoch: number;
    readonly now: Date;
  },
) {
  await database
    .insert(githubCheckHeadReconciliation)
    .values({
      id: randomUUIDv7(),
      organizationId: context.organizationId,
      repositorySyncId: context.repositorySyncId,
      headSha: context.headSha,
      status: 'completed',
      triggerKind: 'pull_request_head_reconciled',
      triggerIdentity: `${context.pullRequestNumber}:${context.headEpoch}`,
      availableAt: context.now,
      updatedAt: context.now,
    })
    .onConflictDoNothing();
  const [head] = await database
    .select()
    .from(githubCheckHeadReconciliation)
    .where(
      and(
        eq(githubCheckHeadReconciliation.organizationId, context.organizationId),
        eq(githubCheckHeadReconciliation.repositorySyncId, context.repositorySyncId),
        eq(githubCheckHeadReconciliation.headSha, context.headSha),
      ),
    )
    .limit(1)
    .for('update');
  if (head === undefined) throw new Error('GitHub head reconciliation row was not created.');
  return head;
}

async function rearmLockedHeadJob(
  database: GithubPullReconciliationDatabase,
  head: typeof githubCheckHeadReconciliation.$inferSelect,
  context: {
    readonly pullRequestNumber: number;
    readonly headEpoch: number;
    readonly now: Date;
  },
): Promise<void> {
  const processing = head.status === 'processing';
  await database
    .update(githubCheckHeadReconciliation)
    .set({
      status: processing ? 'processing' : 'pending',
      jobVersion: head.jobVersion + 1,
      triggerKind: 'pull_request_head_reconciled',
      triggerIdentity: `${context.pullRequestNumber}:${context.headEpoch}`,
      availableAt: context.now,
      rerunRequired: processing,
      ...(processing
        ? {}
        : {
            claimToken: null,
            claimedAt: null,
            leaseExpiresAt: null,
            claimedJobVersion: null,
            claimedContextGeneration: null,
          }),
      updatedAt: context.now,
    })
    .where(eq(githubCheckHeadReconciliation.id, head.id));
}

function parsedProviderSnapshot(snapshot: GithubPullRequestHead):
  | {
      readonly valid: true;
      readonly number: number;
      readonly headSha: string;
      readonly providerUpdatedAt: Date;
    }
  | { readonly valid: false } {
  const providerUpdatedAt = new Date(snapshot.providerUpdatedAt);
  if (
    !Number.isSafeInteger(snapshot.number) ||
    snapshot.number <= 0 ||
    !COMMIT_SHA_PATTERN.test(snapshot.headSha) ||
    Number.isNaN(providerUpdatedAt.getTime())
  ) {
    return { valid: false };
  }
  return {
    valid: true,
    number: snapshot.number,
    headSha: snapshot.headSha.toLowerCase(),
    providerUpdatedAt,
  };
}

async function acceptPullRequestHead(
  database: GithubPullReconciliationDatabase,
  claim: ClaimedPullRequest,
  snapshot: Extract<ReturnType<typeof parsedProviderSnapshot>, { readonly valid: true }>,
  input: ReconcileNextGithubPullRequestInput,
  now: Date,
): Promise<GithubPullRequestReconciliationResult> {
  return await atomic(database, async (tx) => {
    const locked = await lockAcceptanceRows(tx, claim, snapshot, now);
    if (locked === null) return result('invalidated');
    const { head, job, pull } = locked;
    if (!claimOwnsJob(claim, pull, job)) {
      await resolveSupersededClaim(tx, claim, pull, job, now);
      return result('invalidated', {
        reconciliationId: claim.reconciliationId,
        pullRequestId: claim.pullRequestId,
      });
    }
    const rejection = providerSnapshotRejection(pull, job, snapshot, now);
    if (rejection !== null) {
      return await markLockedClaimRetry(tx, claim, job, input, now, rejection);
    }
    const corrected = pull.headSha.toLowerCase() !== snapshot.headSha;
    if (corrected) await applyAuthoritativeHeadCorrection(tx, claim, pull, head, snapshot, now);
    else await applyAuthoritativeProviderTime(tx, claim, pull, snapshot, now);
    await completeLockedClaim(tx, job, snapshot, now);
    return result('accepted', {
      reconciliationId: job.id,
      pullRequestId: pull.id,
      corrected,
    });
  });
}

interface LockedAcceptanceRows {
  readonly head: typeof githubCheckHeadReconciliation.$inferSelect | null;
  readonly pull: PullRequestRow;
  readonly job: PullRequestReconciliationRow;
}

async function lockAcceptanceRows(
  database: GithubPullReconciliationDatabase,
  claim: ClaimedPullRequest,
  snapshot: Extract<ReturnType<typeof parsedProviderSnapshot>, { readonly valid: true }>,
  now: Date,
): Promise<LockedAcceptanceRows | null> {
  const [repository] = await database
    .select({ id: githubRepositorySync.id })
    .from(githubRepositorySync)
    .where(
      and(
        eq(githubRepositorySync.organizationId, claim.organizationId),
        eq(githubRepositorySync.id, claim.repositorySyncId),
      ),
    )
    .limit(1)
    .for('update');
  if (repository === undefined) return null;
  const [observedPull] = await database
    .select()
    .from(githubPullRequest)
    .where(eq(githubPullRequest.id, claim.pullRequestId))
    .limit(1);
  const [observedJob] = await database
    .select()
    .from(githubPullRequestReconciliation)
    .where(eq(githubPullRequestReconciliation.id, claim.reconciliationId))
    .limit(1);
  if (observedPull === undefined || observedJob === undefined) return null;
  const observedProviderTime =
    observedPull.providerUpdatedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const activeObservedClaim =
    observedJob.status === 'processing' &&
    observedJob.claimToken === claim.claimToken &&
    observedJob.jobVersion === claim.capturedJobVersion &&
    observedJob.claimedJobVersion === claim.capturedJobVersion &&
    observedJob.claimedHeadEpoch === claim.capturedHeadEpoch &&
    observedJob.capturedHeadEpoch === claim.capturedHeadEpoch &&
    observedJob.leaseExpiresAt !== null &&
    observedJob.leaseExpiresAt.getTime() > now.getTime() &&
    observedPull.headEpoch === claim.capturedHeadEpoch &&
    observedPull.number === snapshot.number;
  const wouldCorrect =
    activeObservedClaim &&
    observedPull.headSha.toLowerCase() !== snapshot.headSha &&
    snapshot.providerUpdatedAt.getTime() >= observedProviderTime;
  const head = wouldCorrect
    ? await lockedHeadJob(database, {
        organizationId: claim.organizationId,
        repositorySyncId: claim.repositorySyncId,
        headSha: snapshot.headSha,
        pullRequestNumber: claim.pullRequestNumber,
        headEpoch: observedPull.headEpoch + 1,
        now,
      })
    : null;
  const [pull] = await database
    .select()
    .from(githubPullRequest)
    .where(eq(githubPullRequest.id, claim.pullRequestId))
    .limit(1)
    .for('update');
  if (pull === undefined) return null;
  const [job] = await database
    .select()
    .from(githubPullRequestReconciliation)
    .where(eq(githubPullRequestReconciliation.id, claim.reconciliationId))
    .limit(1)
    .for('update');
  return job === undefined ? null : { head, pull, job };
}

async function resolveSupersededClaim(
  database: GithubPullReconciliationDatabase,
  claim: ClaimedPullRequest,
  pull: PullRequestRow,
  job: PullRequestReconciliationRow,
  now: Date,
): Promise<void> {
  const stillOwnsToken =
    job.status === 'processing' &&
    job.claimToken === claim.claimToken &&
    job.jobVersion === claim.capturedJobVersion;
  if (!stillOwnsToken) return;
  await database
    .update(githubPullRequestReconciliation)
    .set({
      status: 'completed',
      resolvedHeadSha: pull.headSha,
      resolvedProviderUpdatedAt: pull.providerUpdatedAt,
      lastError: null,
      ...clearClaim(),
      updatedAt: now,
    })
    .where(eq(githubPullRequestReconciliation.id, job.id));
}

function providerSnapshotRejection(
  pull: PullRequestRow,
  job: PullRequestReconciliationRow,
  snapshot: Extract<ReturnType<typeof parsedProviderSnapshot>, { readonly valid: true }>,
  now: Date,
): string | null {
  if (job.leaseExpiresAt === null || job.leaseExpiresAt.getTime() <= now.getTime()) {
    return 'claim_lease_expired';
  }
  if (snapshot.number !== pull.number) return 'provider_identity_mismatch';
  if (
    pull.providerUpdatedAt !== null &&
    snapshot.providerUpdatedAt.getTime() < pull.providerUpdatedAt.getTime()
  ) {
    return 'provider_snapshot_stale';
  }
  return null;
}

async function applyAuthoritativeHeadCorrection(
  database: GithubPullReconciliationDatabase,
  claim: ClaimedPullRequest,
  pull: PullRequestRow,
  head: typeof githubCheckHeadReconciliation.$inferSelect | null,
  snapshot: Extract<ReturnType<typeof parsedProviderSnapshot>, { readonly valid: true }>,
  now: Date,
): Promise<void> {
  if (head === null)
    throw new Error('GitHub pull request correction is missing its locked head job.');
  const correctedHeadEpoch = pull.headEpoch + 1;
  const [updatedPull] = await database
    .update(githubPullRequest)
    .set({
      headSha: snapshot.headSha,
      headEpoch: correctedHeadEpoch,
      providerUpdatedAt: snapshot.providerUpdatedAt,
      githubUpdatedAt: snapshot.providerUpdatedAt,
      checkStatus: 'unknown',
      syncId: nextSyncId,
      updatedAt: now,
    })
    .where(
      and(
        eq(githubPullRequest.id, pull.id),
        eq(githubPullRequest.headEpoch, claim.capturedHeadEpoch),
        eq(githubPullRequest.headSha, pull.headSha),
      ),
    )
    .returning();
  if (updatedPull === undefined) throw new Error('GitHub pull request head claim was lost.');
  await rearmLockedHeadJob(database, head, {
    pullRequestNumber: pull.number,
    headEpoch: correctedHeadEpoch,
    now,
  });
}

async function applyAuthoritativeProviderTime(
  database: GithubPullReconciliationDatabase,
  claim: ClaimedPullRequest,
  pull: PullRequestRow,
  snapshot: Extract<ReturnType<typeof parsedProviderSnapshot>, { readonly valid: true }>,
  now: Date,
): Promise<void> {
  if (
    pull.providerUpdatedAt !== null &&
    snapshot.providerUpdatedAt.getTime() <= pull.providerUpdatedAt.getTime()
  ) {
    return;
  }
  await database
    .update(githubPullRequest)
    .set({
      providerUpdatedAt: snapshot.providerUpdatedAt,
      githubUpdatedAt: snapshot.providerUpdatedAt,
      syncId: nextSyncId,
      updatedAt: now,
    })
    .where(
      and(
        eq(githubPullRequest.id, pull.id),
        eq(githubPullRequest.headEpoch, claim.capturedHeadEpoch),
      ),
    );
}

async function completeLockedClaim(
  database: GithubPullReconciliationDatabase,
  job: PullRequestReconciliationRow,
  snapshot: Extract<ReturnType<typeof parsedProviderSnapshot>, { readonly valid: true }>,
  now: Date,
): Promise<void> {
  await database
    .update(githubPullRequestReconciliation)
    .set({
      status: 'completed',
      resolvedHeadSha: snapshot.headSha,
      resolvedProviderUpdatedAt: snapshot.providerUpdatedAt,
      lastError: null,
      ...clearClaim(),
      updatedAt: now,
    })
    .where(eq(githubPullRequestReconciliation.id, job.id));
}

async function markLockedClaimRetry(
  database: GithubPullReconciliationDatabase,
  claim: ClaimedPullRequest,
  job: PullRequestReconciliationRow,
  input: ReconcileNextGithubPullRequestInput,
  now: Date,
  failure: string,
): Promise<GithubPullRequestReconciliationResult> {
  const exhausted = claim.attemptNumber >= positiveInteger(input.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  await database
    .update(githubPullRequestReconciliation)
    .set({
      status: exhausted ? 'failed' : 'pending',
      availableAt: retryAt(now, claim.attemptNumber, input),
      lastError: failure,
      ...clearClaim(),
      updatedAt: now,
    })
    .where(eq(githubPullRequestReconciliation.id, job.id));
  return result(exhausted ? 'failed' : 'retry_scheduled', {
    reconciliationId: job.id,
    pullRequestId: claim.pullRequestId,
  });
}

export async function reconcileNextGithubPullRequest(
  database: GithubPullReconciliationDatabase,
  input: ReconcileNextGithubPullRequestInput,
): Promise<GithubPullRequestReconciliationResult> {
  const claimNow = currentTime(input.now);
  const claimResult = await atomic(database, (tx) => claimNextPullRequest(tx, input, claimNow));
  if (claimResult.kind === 'idle') return result('idle');
  if (claimResult.kind === 'finished') return claimResult.result;
  const { claim } = claimResult;
  const fetchPullRequestHead = input.fetchPullRequestHead ?? fetchGithubPullRequestHeadFromProvider;
  let providerSnapshot: GithubPullRequestHead;
  try {
    providerSnapshot = await fetchPullRequestHead({
      appId: input.appId,
      privateKey: input.privateKey,
      installationId: claim.installationId,
      repository: claim.repositoryName,
      pullRequestNumber: claim.pullRequestNumber,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      ...(input.apiBase === undefined ? {} : { apiBase: input.apiBase }),
    });
  } catch {
    return await markClaimFailure(
      database,
      claim,
      input,
      currentTime(input.now),
      'github_pull_request_provider_request_failed',
    );
  }
  const completedAt = currentTime(input.now);
  const snapshot = parsedProviderSnapshot(providerSnapshot);
  if (!snapshot.valid) {
    return await markClaimFailure(
      database,
      claim,
      input,
      completedAt,
      'github_pull_request_provider_payload_invalid',
    );
  }
  return await acceptPullRequestHead(database, claim, snapshot, input, completedAt);
}
