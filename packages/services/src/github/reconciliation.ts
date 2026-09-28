import { createHash } from 'node:crypto';
import type { Database, Transaction } from '@orbit/db';
import {
  githubCheckActivity,
  githubCheckHeadContext,
  githubCheckHeadReconciliation,
  githubCheckReconciliationFetch,
  githubPullRequest,
  githubPullRequestCheckContext,
  githubRepositorySync,
  nextSyncId,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, asc, eq, lte, or } from 'drizzle-orm';
import {
  fetchGithubCheckHeadSnapshot,
  type GithubAppRequest,
  type GithubCheckHeadSnapshot,
  type GithubCheckHeadSnapshotActivity,
} from './app.ts';

export type GithubReconciliationDatabase = Database | Transaction;

export interface GithubCheckFailureTransition {
  readonly organizationId: string;
  readonly repositorySyncId: string;
  readonly pullRequestId: string;
  readonly headSha: string;
  readonly headEpoch: number;
  readonly previousStatus: string;
  readonly currentStatus: 'failure';
}

export interface GithubCheckHeadReconciliationResult {
  readonly status: 'idle' | 'accepted' | 'retry_scheduled' | 'invalidated' | 'failed';
  readonly reconciliationId: string | null;
  readonly fetchAttemptId: string | null;
  readonly failureTransitions: GithubCheckFailureTransition[];
}

export type GithubCheckHeadSnapshotFetcher = (
  input: GithubAppRequest & { readonly repository: string; readonly headSha: string },
) => Promise<GithubCheckHeadSnapshot>;

export interface ReconcileNextGithubCheckHeadInput {
  readonly appId: string;
  readonly privateKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBase?: string;
  readonly organizationId?: string;
  readonly now?: Date;
  readonly leaseMs?: number;
  readonly settleWindowMs?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
  readonly maxAttempts?: number;
  readonly fetchSnapshot?: GithubCheckHeadSnapshotFetcher;
  readonly acceptFailureTransitions?: (
    database: GithubReconciliationDatabase,
    transitions: readonly GithubCheckFailureTransition[],
  ) => Promise<void>;
}

interface ClaimedHead {
  readonly reconciliationId: string;
  readonly organizationId: string;
  readonly repositorySyncId: string;
  readonly repositoryName: string;
  readonly installationId: string;
  readonly headSha: string;
  readonly claimToken: string;
  readonly capturedJobVersion: number;
  readonly capturedContextGeneration: number;
  readonly attemptNumber: number;
  readonly fetchAttemptId: string;
  readonly settleDeadline: Date;
}

const DEFAULT_LEASE_MS = 180_000;
const DEFAULT_SETTLE_WINDOW_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 8;

function idleResult(): GithubCheckHeadReconciliationResult {
  return {
    status: 'idle',
    reconciliationId: null,
    fetchAttemptId: null,
    failureTransitions: [],
  };
}

async function atomic<T>(
  database: GithubReconciliationDatabase,
  operation: (tx: GithubReconciliationDatabase) => Promise<T>,
): Promise<T> {
  if ('$client' in database) return await database.transaction(operation);
  return await operation(database);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return fallback;
  return value;
}

function availableAtForAttempt(
  now: Date,
  attemptNumber: number,
  input: ReconcileNextGithubCheckHeadInput,
) {
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
    claimedContextGeneration: null,
  };
}

async function claimNextHead(
  database: GithubReconciliationDatabase,
  input: ReconcileNextGithubCheckHeadInput,
  now: Date,
): Promise<ClaimedHead | null> {
  const [candidate] = await database
    .select({
      id: githubCheckHeadReconciliation.id,
      repositorySyncId: githubCheckHeadReconciliation.repositorySyncId,
    })
    .from(githubCheckHeadReconciliation)
    .where(
      and(
        input.organizationId === undefined
          ? undefined
          : eq(githubCheckHeadReconciliation.organizationId, input.organizationId),
        or(
          and(
            eq(githubCheckHeadReconciliation.status, 'pending'),
            lte(githubCheckHeadReconciliation.availableAt, now),
          ),
          and(
            eq(githubCheckHeadReconciliation.status, 'processing'),
            lte(githubCheckHeadReconciliation.leaseExpiresAt, now),
          ),
        ),
      ),
    )
    .orderBy(asc(githubCheckHeadReconciliation.availableAt), asc(githubCheckHeadReconciliation.id))
    .limit(1);
  if (candidate === undefined) return null;
  const [repository] = await database
    .select()
    .from(githubRepositorySync)
    .where(eq(githubRepositorySync.id, candidate.repositorySyncId))
    .limit(1)
    .for('update');
  if (repository === undefined) return null;
  const [head] = await database
    .select()
    .from(githubCheckHeadReconciliation)
    .where(eq(githubCheckHeadReconciliation.id, candidate.id))
    .limit(1)
    .for('update');
  if (head === undefined) return null;
  const claimable =
    (head.status === 'pending' && head.availableAt.getTime() <= now.getTime()) ||
    (head.status === 'processing' &&
      head.leaseExpiresAt !== null &&
      head.leaseExpiresAt.getTime() <= now.getTime());
  if (!claimable) return null;
  if (head.status === 'processing') {
    await database
      .update(githubCheckReconciliationFetch)
      .set({ disposition: 'abandoned', completedAt: now, updatedAt: now })
      .where(
        and(
          eq(githubCheckReconciliationFetch.headReconciliationId, head.id),
          eq(githubCheckReconciliationFetch.disposition, 'started'),
        ),
      );
    await database
      .update(githubCheckReconciliationFetch)
      .set({ disposition: 'invalidated', completedAt: now, updatedAt: now })
      .where(
        and(
          eq(githubCheckReconciliationFetch.headReconciliationId, head.id),
          eq(githubCheckReconciliationFetch.disposition, 'fetched'),
        ),
      );
  }
  const claimToken = randomUUIDv7();
  const fetchAttemptId = randomUUIDv7();
  const attemptNumber = head.attempts + 1;
  const settleDeadline =
    head.settleDeadline ??
    new Date(now.getTime() + positiveInteger(input.settleWindowMs, DEFAULT_SETTLE_WINDOW_MS));
  const leaseExpiresAt = new Date(now.getTime() + positiveInteger(input.leaseMs, DEFAULT_LEASE_MS));
  const [claimed] = await database
    .update(githubCheckHeadReconciliation)
    .set({
      status: 'processing',
      attempts: attemptNumber,
      settleDeadline,
      rerunRequired: false,
      claimToken,
      claimedAt: now,
      leaseExpiresAt,
      claimedJobVersion: head.jobVersion,
      claimedContextGeneration: head.contextGeneration,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(githubCheckHeadReconciliation.id, head.id))
    .returning();
  if (claimed === undefined) return null;
  await database.insert(githubCheckReconciliationFetch).values({
    id: fetchAttemptId,
    organizationId: head.organizationId,
    repositorySyncId: head.repositorySyncId,
    headSha: head.headSha,
    headReconciliationId: head.id,
    attemptNumber,
    capturedJobVersion: head.jobVersion,
    capturedContextGeneration: head.contextGeneration,
    claimToken,
    disposition: 'started',
    requestedAt: now,
    updatedAt: now,
  });
  return {
    reconciliationId: head.id,
    organizationId: head.organizationId,
    repositorySyncId: head.repositorySyncId,
    repositoryName: repository.repositoryName,
    installationId: repository.installationId,
    headSha: head.headSha,
    claimToken,
    capturedJobVersion: head.jobVersion,
    capturedContextGeneration: head.contextGeneration,
    attemptNumber,
    fetchAttemptId,
    settleDeadline,
  };
}

function fetchedActivityPayload(
  activity: GithubCheckHeadSnapshotActivity,
): Record<string, unknown> {
  return {
    appId: activity.appId,
    conclusion: activity.conclusion,
    context: activity.providerContext,
    creator: activity.creator,
    status: activity.status,
    url: activity.url,
  };
}

function serializedSnapshot(snapshot: GithubCheckHeadSnapshot): Record<string, unknown>[] {
  return snapshot.contexts.map((context) => ({
    appId: context.appId,
    conclusion: context.conclusion,
    contextKey: context.contextKey,
    creator: context.creator,
    providerContext: context.providerContext,
    providerObjectId: context.providerObjectId,
    providerRunId: context.providerRunId,
    providerUpdatedAt: context.providerUpdatedAt,
    sourceKind: context.sourceKind,
    state: context.state,
    status: context.status,
    url: context.url,
  }));
}

function snapshotHash(snapshot: GithubCheckHeadSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function activityIdentity(activity: GithubCheckHeadSnapshotActivity): string {
  return JSON.stringify([
    activity.sourceKind,
    activity.providerObjectId,
    new Date(activity.providerUpdatedAt).toISOString(),
  ]);
}

async function persistFetchedSnapshot(
  database: GithubReconciliationDatabase,
  claim: ClaimedHead,
  snapshot: GithubCheckHeadSnapshot,
  now: Date,
): Promise<void> {
  const [repository] = await database
    .select({ id: githubRepositorySync.id })
    .from(githubRepositorySync)
    .where(eq(githubRepositorySync.id, claim.repositorySyncId))
    .limit(1)
    .for('update');
  if (repository === undefined) return;
  const [head] = await database
    .select()
    .from(githubCheckHeadReconciliation)
    .where(eq(githubCheckHeadReconciliation.id, claim.reconciliationId))
    .limit(1)
    .for('update');
  const [fetchAttempt] = await database
    .select()
    .from(githubCheckReconciliationFetch)
    .where(eq(githubCheckReconciliationFetch.id, claim.fetchAttemptId))
    .limit(1)
    .for('update');
  if (fetchAttempt === undefined) return;
  for (const activity of snapshot.activities) {
    const providerUpdatedAt = new Date(activity.providerUpdatedAt);
    await database
      .insert(githubCheckActivity)
      .values({
        id: randomUUIDv7(),
        organizationId: claim.organizationId,
        repositorySyncId: claim.repositorySyncId,
        headSha: claim.headSha,
        sourceKind: activity.sourceKind,
        contextKey: activity.contextKey,
        providerObjectId: activity.providerObjectId,
        providerRunId: activity.providerRunId,
        providerUpdatedAt,
        reconciliationFetchId: claim.fetchAttemptId,
        state: activity.state,
        payload: fetchedActivityPayload(activity),
        occurredAt: providerUpdatedAt,
      })
      .onConflictDoNothing();
  }
  const disposition = fetchAttempt.disposition === 'started' ? 'fetched' : fetchAttempt.disposition;
  await database
    .update(githubCheckReconciliationFetch)
    .set({
      disposition,
      completedAt: now,
      resultHash: snapshotHash(snapshot),
      updatedAt: now,
    })
    .where(eq(githubCheckReconciliationFetch.id, claim.fetchAttemptId));
  if (head?.claimToken === claim.claimToken) {
    await database
      .update(githubCheckHeadReconciliation)
      .set({ latestSnapshot: serializedSnapshot(snapshot), updatedAt: now })
      .where(eq(githubCheckHeadReconciliation.id, claim.reconciliationId));
  }
}

async function markFetchFailure(
  database: GithubReconciliationDatabase,
  claim: ClaimedHead,
  failure: string,
  now: Date,
  input: ReconcileNextGithubCheckHeadInput,
): Promise<'retry_scheduled' | 'failed'> {
  const [repository] = await database
    .select({ id: githubRepositorySync.id })
    .from(githubRepositorySync)
    .where(eq(githubRepositorySync.id, claim.repositorySyncId))
    .limit(1)
    .for('update');
  if (repository === undefined) return 'failed';
  const [head] = await database
    .select()
    .from(githubCheckHeadReconciliation)
    .where(eq(githubCheckHeadReconciliation.id, claim.reconciliationId))
    .limit(1)
    .for('update');
  const [fetchAttempt] = await database
    .select()
    .from(githubCheckReconciliationFetch)
    .where(eq(githubCheckReconciliationFetch.id, claim.fetchAttemptId))
    .limit(1)
    .for('update');
  if (fetchAttempt !== undefined && fetchAttempt.disposition === 'started') {
    await database
      .update(githubCheckReconciliationFetch)
      .set({ disposition: 'failed', failure, completedAt: now, updatedAt: now })
      .where(eq(githubCheckReconciliationFetch.id, fetchAttempt.id));
  }
  const maxAttempts = positiveInteger(input.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const superseded =
    head !== undefined &&
    (head.jobVersion !== claim.capturedJobVersion ||
      head.contextGeneration !== claim.capturedContextGeneration ||
      head.rerunRequired);
  const exhausted = !superseded && claim.attemptNumber >= maxAttempts;
  if (head?.claimToken === claim.claimToken) {
    await database
      .update(githubCheckHeadReconciliation)
      .set({
        status: exhausted ? 'failed' : 'pending',
        ...(superseded
          ? {}
          : { availableAt: availableAtForAttempt(now, claim.attemptNumber, input) }),
        rerunRequired: false,
        lastError: superseded ? null : failure,
        ...clearClaim(),
        updatedAt: now,
      })
      .where(eq(githubCheckHeadReconciliation.id, claim.reconciliationId));
  }
  return exhausted ? 'failed' : 'retry_scheduled';
}

function aggregateCheckStates(states: readonly string[]): string {
  if (states.includes('failure')) return 'failure';
  if (states.includes('pending')) return 'pending';
  if (states.length > 0 && states.every((state) => state === 'success')) return 'success';
  return 'unknown';
}

type HeadReconciliationRow = typeof githubCheckHeadReconciliation.$inferSelect;
type ReconciliationFetchRow = typeof githubCheckReconciliationFetch.$inferSelect;
type CheckActivityRow = typeof githubCheckActivity.$inferSelect;
type HeadContextRow = typeof githubCheckHeadContext.$inferSelect;
type PullRequestRow = typeof githubPullRequest.$inferSelect;

async function invalidateLockedClaim(
  database: GithubReconciliationDatabase,
  claim: ClaimedHead,
  head: HeadReconciliationRow | undefined,
  fetchAttempt: ReconciliationFetchRow | undefined,
  now: Date,
  input: ReconcileNextGithubCheckHeadInput,
  reason: string,
): Promise<void> {
  if (fetchAttempt?.disposition === 'fetched') {
    await database
      .update(githubCheckReconciliationFetch)
      .set({ disposition: 'invalidated', failure: reason, updatedAt: now })
      .where(eq(githubCheckReconciliationFetch.id, claim.fetchAttemptId));
  }
  if (head?.claimToken !== claim.claimToken) return;
  await database
    .update(githubCheckHeadReconciliation)
    .set({
      status: 'pending',
      availableAt: availableAtForAttempt(now, claim.attemptNumber, input),
      rerunRequired: false,
      lastError: reason,
      ...clearClaim(),
      updatedAt: now,
    })
    .where(eq(githubCheckHeadReconciliation.id, claim.reconciliationId));
}

function invalidatedResult(
  claim: ClaimedHead,
  status: 'invalidated' | 'retry_scheduled',
): GithubCheckHeadReconciliationResult {
  return {
    status,
    reconciliationId: claim.reconciliationId,
    fetchAttemptId: claim.fetchAttemptId,
    failureTransitions: [],
  };
}

function claimAcceptsSnapshot(
  claim: ClaimedHead,
  head: HeadReconciliationRow | undefined,
  fetchAttempt: ReconciliationFetchRow | undefined,
  snapshot: GithubCheckHeadSnapshot,
  now: Date,
): boolean {
  return (
    head !== undefined &&
    fetchAttempt?.disposition === 'fetched' &&
    head.status === 'processing' &&
    head.claimToken === claim.claimToken &&
    head.jobVersion === claim.capturedJobVersion &&
    head.contextGeneration === claim.capturedContextGeneration &&
    head.claimedJobVersion === claim.capturedJobVersion &&
    head.claimedContextGeneration === claim.capturedContextGeneration &&
    fetchAttempt.claimToken === claim.claimToken &&
    fetchAttempt.capturedJobVersion === claim.capturedJobVersion &&
    fetchAttempt.capturedContextGeneration === claim.capturedContextGeneration &&
    head.leaseExpiresAt !== null &&
    head.leaseExpiresAt.getTime() > now.getTime() &&
    snapshot.headSha.toLowerCase() === claim.headSha.toLowerCase()
  );
}

interface PreparedSnapshotContext {
  readonly context: GithubCheckHeadSnapshotActivity;
  readonly activity: CheckActivityRow;
}

type PreparedSnapshot =
  | {
      readonly valid: true;
      readonly contextKeys: ReadonlySet<string>;
      readonly contexts: readonly PreparedSnapshotContext[];
    }
  | { readonly valid: false; readonly reason: string };

function prepareSnapshotContexts(
  snapshot: GithubCheckHeadSnapshot,
  rawActivities: readonly CheckActivityRow[],
): PreparedSnapshot {
  const activityByIdentity = new Map(
    rawActivities.map((activity) => [
      JSON.stringify([
        activity.sourceKind,
        activity.providerObjectId,
        activity.providerUpdatedAt.toISOString(),
      ]),
      activity,
    ]),
  );
  const contextKeys = new Set<string>();
  const contexts: PreparedSnapshotContext[] = [];
  for (const context of snapshot.contexts) {
    if (contextKeys.has(context.contextKey)) {
      return { valid: false, reason: 'duplicate_snapshot_context' };
    }
    const activity = activityByIdentity.get(activityIdentity(context));
    if (activity === undefined) {
      return { valid: false, reason: 'snapshot_context_activity_missing' };
    }
    contextKeys.add(context.contextKey);
    contexts.push({ context, activity });
  }
  return { valid: true, contextKeys, contexts };
}

async function replaceHeadContexts(
  database: GithubReconciliationDatabase,
  claim: ClaimedHead,
  prepared: Extract<PreparedSnapshot, { readonly valid: true }>,
  now: Date,
): Promise<HeadContextRow[]> {
  const currentContexts = await database
    .select()
    .from(githubCheckHeadContext)
    .where(
      and(
        eq(githubCheckHeadContext.organizationId, claim.organizationId),
        eq(githubCheckHeadContext.repositorySyncId, claim.repositorySyncId),
        eq(githubCheckHeadContext.headSha, claim.headSha),
      ),
    )
    .orderBy(asc(githubCheckHeadContext.contextKey))
    .for('update');
  const currentByKey = new Map(currentContexts.map((context) => [context.contextKey, context]));
  const acceptedContexts: HeadContextRow[] = [];
  for (const preparedContext of prepared.contexts) {
    const { activity, context } = preparedContext;
    const current = currentByKey.get(context.contextKey);
    const values = {
      sourceKind: context.sourceKind,
      state: context.state,
      providerUpdatedAt: new Date(context.providerUpdatedAt),
      latestProviderObjectId: context.providerObjectId,
      latestProviderRunId: context.providerRunId,
      active: true,
      contextVersion: (current?.contextVersion ?? 0) + 1,
      latestActivityId: activity.id,
      reconciliationState: 'resolved',
      reconciliationAttempts: 0,
      reconciliationAvailableAt: now,
      reconciliationClaimToken: null,
      reconciliationClaimedAt: null,
      reconciliationLeaseExpiresAt: null,
      reconciliationClaimedVersion: null,
      reconciliationClaimedHeadGeneration: null,
      lastReconciliationError: null,
      updatedAt: now,
    };
    const [accepted] = await database
      .insert(githubCheckHeadContext)
      .values({
        id: current?.id ?? randomUUIDv7(),
        organizationId: claim.organizationId,
        repositorySyncId: claim.repositorySyncId,
        headSha: claim.headSha,
        contextKey: context.contextKey,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          githubCheckHeadContext.organizationId,
          githubCheckHeadContext.repositorySyncId,
          githubCheckHeadContext.headSha,
          githubCheckHeadContext.contextKey,
        ],
        set: values,
      })
      .returning();
    if (accepted !== undefined) acceptedContexts.push(accepted);
  }
  for (const current of currentContexts) {
    if (prepared.contextKeys.has(current.contextKey)) continue;
    await database
      .update(githubCheckHeadContext)
      .set({
        active: false,
        contextVersion: current.contextVersion + 1,
        reconciliationState: 'resolved',
        reconciliationAttempts: 0,
        reconciliationAvailableAt: now,
        reconciliationClaimToken: null,
        reconciliationClaimedAt: null,
        reconciliationLeaseExpiresAt: null,
        reconciliationClaimedVersion: null,
        reconciliationClaimedHeadGeneration: null,
        lastReconciliationError: null,
        updatedAt: now,
      })
      .where(eq(githubCheckHeadContext.id, current.id));
  }
  return acceptedContexts;
}

async function projectAcceptedContextsToPull(
  database: GithubReconciliationDatabase,
  pull: PullRequestRow,
  acceptedContexts: readonly HeadContextRow[],
  activeContextKeys: ReadonlySet<string>,
  now: Date,
): Promise<GithubCheckFailureTransition | null> {
  const projections = await database
    .select()
    .from(githubPullRequestCheckContext)
    .where(
      and(
        eq(githubPullRequestCheckContext.organizationId, pull.organizationId),
        eq(githubPullRequestCheckContext.pullRequestId, pull.id),
        eq(githubPullRequestCheckContext.capturedHeadEpoch, pull.headEpoch),
        eq(githubPullRequestCheckContext.headSha, pull.headSha),
      ),
    )
    .orderBy(asc(githubPullRequestCheckContext.contextKey))
    .for('update');
  for (const projection of projections) {
    if (activeContextKeys.has(projection.contextKey)) continue;
    await database
      .delete(githubPullRequestCheckContext)
      .where(eq(githubPullRequestCheckContext.id, projection.id));
  }
  for (const headContext of acceptedContexts) {
    const values = {
      headContextId: headContext.id,
      headSha: headContext.headSha,
      projectedContextVersion: headContext.contextVersion,
      projectedState: headContext.state,
      latestActivityId: headContext.latestActivityId,
      updatedAt: now,
    };
    await database
      .insert(githubPullRequestCheckContext)
      .values({
        id: randomUUIDv7(),
        organizationId: pull.organizationId,
        repositorySyncId: pull.repositorySyncId,
        pullRequestId: pull.id,
        contextKey: headContext.contextKey,
        capturedHeadEpoch: pull.headEpoch,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          githubPullRequestCheckContext.organizationId,
          githubPullRequestCheckContext.pullRequestId,
          githubPullRequestCheckContext.capturedHeadEpoch,
          githubPullRequestCheckContext.contextKey,
        ],
        set: values,
      });
  }
  const projectedStates = await database
    .select({ state: githubPullRequestCheckContext.projectedState })
    .from(githubPullRequestCheckContext)
    .where(
      and(
        eq(githubPullRequestCheckContext.organizationId, pull.organizationId),
        eq(githubPullRequestCheckContext.pullRequestId, pull.id),
        eq(githubPullRequestCheckContext.capturedHeadEpoch, pull.headEpoch),
        eq(githubPullRequestCheckContext.headSha, pull.headSha),
      ),
    );
  const checkStatus = aggregateCheckStates(projectedStates.map((entry) => entry.state));
  const [updatedPull] = await database
    .update(githubPullRequest)
    .set({ checkStatus, syncId: nextSyncId, updatedAt: now })
    .where(
      and(
        eq(githubPullRequest.id, pull.id),
        eq(githubPullRequest.headSha, pull.headSha),
        eq(githubPullRequest.headEpoch, pull.headEpoch),
      ),
    )
    .returning();
  if (updatedPull === undefined || pull.checkStatus === 'failure' || checkStatus !== 'failure') {
    return null;
  }
  return {
    organizationId: pull.organizationId,
    repositorySyncId: pull.repositorySyncId,
    pullRequestId: pull.id,
    headSha: pull.headSha,
    headEpoch: pull.headEpoch,
    previousStatus: pull.checkStatus,
    currentStatus: 'failure',
  };
}

async function projectAcceptedContexts(
  database: GithubReconciliationDatabase,
  claim: ClaimedHead,
  acceptedContexts: readonly HeadContextRow[],
  activeContextKeys: ReadonlySet<string>,
  now: Date,
): Promise<GithubCheckFailureTransition[]> {
  const pulls = await database
    .select()
    .from(githubPullRequest)
    .where(
      and(
        eq(githubPullRequest.organizationId, claim.organizationId),
        eq(githubPullRequest.repositorySyncId, claim.repositorySyncId),
        eq(githubPullRequest.headSha, claim.headSha),
      ),
    )
    .orderBy(asc(githubPullRequest.id))
    .for('update');
  const transitions: GithubCheckFailureTransition[] = [];
  for (const pull of pulls) {
    const transition = await projectAcceptedContextsToPull(
      database,
      pull,
      acceptedContexts,
      activeContextKeys,
      now,
    );
    if (transition !== null) transitions.push(transition);
  }
  return transitions;
}

async function acceptFetchedSnapshot(
  database: GithubReconciliationDatabase,
  claim: ClaimedHead,
  snapshot: GithubCheckHeadSnapshot,
  now: Date,
  input: ReconcileNextGithubCheckHeadInput,
): Promise<GithubCheckHeadReconciliationResult> {
  const [repository] = await database
    .select()
    .from(githubRepositorySync)
    .where(eq(githubRepositorySync.id, claim.repositorySyncId))
    .limit(1)
    .for('update');
  if (repository === undefined) return idleResult();
  const [head] = await database
    .select()
    .from(githubCheckHeadReconciliation)
    .where(eq(githubCheckHeadReconciliation.id, claim.reconciliationId))
    .limit(1)
    .for('update');
  const [fetchAttempt] = await database
    .select()
    .from(githubCheckReconciliationFetch)
    .where(eq(githubCheckReconciliationFetch.id, claim.fetchAttemptId))
    .limit(1)
    .for('update');
  if (!claimAcceptsSnapshot(claim, head, fetchAttempt, snapshot, now) || head === undefined) {
    await invalidateLockedClaim(
      database,
      claim,
      head,
      fetchAttempt,
      now,
      input,
      'stale_reconciliation_fetch',
    );
    return invalidatedResult(claim, 'invalidated');
  }
  if (snapshot.contexts.length === 0 && now.getTime() < claim.settleDeadline.getTime()) {
    await invalidateLockedClaim(
      database,
      claim,
      head,
      fetchAttempt,
      now,
      input,
      'empty_snapshot_before_settle_deadline',
    );
    return invalidatedResult(claim, 'retry_scheduled');
  }
  const rawActivities = await database
    .select()
    .from(githubCheckActivity)
    .where(eq(githubCheckActivity.reconciliationFetchId, claim.fetchAttemptId))
    .orderBy(asc(githubCheckActivity.id))
    .for('update');
  const prepared = prepareSnapshotContexts(snapshot, rawActivities);
  if (!prepared.valid) {
    await invalidateLockedClaim(database, claim, head, fetchAttempt, now, input, prepared.reason);
    return invalidatedResult(claim, 'invalidated');
  }
  const acceptedContexts = await replaceHeadContexts(database, claim, prepared, now);
  const failureTransitions = await projectAcceptedContexts(
    database,
    claim,
    acceptedContexts,
    prepared.contextKeys,
    now,
  );
  if (input.acceptFailureTransitions !== undefined) {
    await input.acceptFailureTransitions(database, failureTransitions);
  }
  const nextGeneration = head.contextGeneration + 1;
  await database
    .update(githubCheckReconciliationFetch)
    .set({ disposition: 'accepted', failure: null, updatedAt: now })
    .where(eq(githubCheckReconciliationFetch.id, claim.fetchAttemptId));
  await database
    .update(githubCheckHeadReconciliation)
    .set({
      status: 'completed',
      contextGeneration: nextGeneration,
      rerunRequired: false,
      acceptedFetchAttemptId: claim.fetchAttemptId,
      acceptedJobVersion: claim.capturedJobVersion,
      acceptedContextGeneration: nextGeneration,
      latestSnapshot: serializedSnapshot(snapshot),
      lastError: null,
      ...clearClaim(),
      updatedAt: now,
    })
    .where(eq(githubCheckHeadReconciliation.id, claim.reconciliationId));
  return {
    status: 'accepted',
    reconciliationId: claim.reconciliationId,
    fetchAttemptId: claim.fetchAttemptId,
    failureTransitions,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message.slice(0, 2000);
  return 'GitHub check reconciliation fetch failed.';
}

export async function reconcileNextGithubCheckHead(
  database: GithubReconciliationDatabase,
  input: ReconcileNextGithubCheckHeadInput,
): Promise<GithubCheckHeadReconciliationResult> {
  const claimNow = input.now ?? new Date();
  const claim = await atomic(database, async (tx) => await claimNextHead(tx, input, claimNow));
  if (claim === null) return idleResult();
  const fetchSnapshot = input.fetchSnapshot ?? fetchGithubCheckHeadSnapshot;
  let snapshot: GithubCheckHeadSnapshot;
  try {
    snapshot = await fetchSnapshot({
      appId: input.appId,
      privateKey: input.privateKey,
      installationId: claim.installationId,
      repository: claim.repositoryName,
      headSha: claim.headSha,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      ...(input.apiBase === undefined ? {} : { apiBase: input.apiBase }),
    });
  } catch (error) {
    const failedAt = input.now ?? new Date();
    const status = await atomic(
      database,
      async (tx) => await markFetchFailure(tx, claim, errorMessage(error), failedAt, input),
    );
    return {
      status,
      reconciliationId: claim.reconciliationId,
      fetchAttemptId: claim.fetchAttemptId,
      failureTransitions: [],
    };
  }
  const fetchedAt = input.now ?? new Date();
  await atomic(
    database,
    async (tx) => await persistFetchedSnapshot(tx, claim, snapshot, fetchedAt),
  );
  return await atomic(
    database,
    async (tx) => await acceptFetchedSnapshot(tx, claim, snapshot, fetchedAt, input),
  );
}
