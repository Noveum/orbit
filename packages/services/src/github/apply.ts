import type { Database, Transaction } from '@orbit/db';
import {
  account,
  githubCheckActivity,
  githubCheckHeadContext,
  githubCheckHeadReconciliation,
  githubPullRequest,
  githubPullRequestActivity,
  githubPullRequestCheckContext,
  githubPullRequestReconciliation,
  githubRepositorySync,
  gitLink,
  issue,
  issueLabel,
  issueReviewer,
  issueSubscription,
  member,
  nextSyncId,
  teamMember,
  user,
  workflowState,
} from '@orbit/db/schema';
import {
  type Actor,
  extractIssueIdentifiers,
  type StateCategory,
  type SyncAction,
  scopes,
  unique,
} from '@orbit/shared';
import { isInOrganization, isInTeam, type Principal, policyRole } from '@orbit/shared/policy';
import { declaredIssueIdentifiers, randomUUIDv7 } from '@orbit/shared/utils';
import { and, asc, eq, getTableColumns, inArray, lte, or, sql } from 'drizzle-orm';
import type { NotificationEvent } from '../notifications/index.ts';
import type { GithubPullRequestHistoryEntry } from './app.ts';
import {
  canAdvance,
  type NormalizedGithubCheckContext,
  type NormalizedGithubEvent,
  notificationTypeForReview,
  notificationTypeForState,
  type PullRequestState,
  parseGithubEvent,
  pullRequestState,
  targetCategoryFor,
} from './index.ts';

export type GithubDatabase = Database | Transaction;
export type GitLinkRow = typeof gitLink.$inferSelect;
export type GithubPullRequestRow = typeof githubPullRequest.$inferSelect;
type RepositorySync = typeof githubRepositorySync.$inferSelect;

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export type GithubIgnoredReason =
  | 'unsupported_event'
  | 'repository_not_connected'
  | 'repository_disabled'
  | 'no_issue_identifier'
  | 'no_matching_issue';

export interface GithubApplyResult {
  readonly handled: boolean;
  readonly ignoredReason: GithubIgnoredReason | null;
  readonly organizationId: string | null;
  readonly actions: SyncAction[];
  readonly notificationEvents: NotificationEvent[];
  readonly teamIds: string[];
  readonly gitLinks: GitLinkRow[];
  readonly pullRequests: GithubPullRequestRow[];
}

interface GithubMirrorOutcome {
  readonly pullRequests: GithubPullRequestRow[];
  readonly failedTransitionPullRequestIds: ReadonlySet<string>;
}

interface MirroredPullRequestUpsert {
  readonly row: GithubPullRequestRow;
  readonly headChanged: boolean;
  readonly created: boolean;
}

interface LinkedIssue {
  readonly id: string;
  readonly teamId: string;
  readonly identifier: string;
  readonly stateId: string;
  readonly category: StateCategory;
  readonly assigneeId: string | null;
  readonly creatorId: string;
  readonly startedAt: Date | null;
  readonly subscriberIds: string[];
}

const EMPTY: GithubApplyResult = {
  handled: false,
  ignoredReason: null,
  organizationId: null,
  actions: [],
  notificationEvents: [],
  teamIds: [],
  gitLinks: [],
  pullRequests: [],
};

export async function applyGithubEvent(
  database: GithubDatabase,
  input: {
    readonly eventName: string;
    readonly body: unknown;
    readonly organizationId?: string | null;
    readonly webhookDeliveryId?: string;
    readonly now?: Date;
  },
): Promise<GithubApplyResult> {
  const event = parseGithubEvent(input.eventName, input.body);
  if (event === null) return { ...EMPTY, ignoredReason: 'unsupported_event' };

  return await applyNormalizedGithubEvent(database, {
    event,
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
    ...(input.webhookDeliveryId === undefined
      ? {}
      : { webhookDeliveryId: input.webhookDeliveryId }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export async function applyNormalizedGithubEvent(
  database: GithubDatabase,
  input: {
    readonly event: NormalizedGithubEvent;
    readonly organizationId?: string | null;
    readonly webhookDeliveryId?: string;
    readonly now?: Date;
  },
): Promise<GithubApplyResult> {
  if ('$client' in database) {
    return await database.transaction((tx) => applyNormalizedGithubEvent(tx, input));
  }
  const { event } = input;
  if (input.organizationId === null) {
    return { ...EMPTY, ignoredReason: 'repository_not_connected' };
  }

  const [repo] = await database
    .select()
    .from(githubRepositorySync)
    .where(
      and(
        eq(githubRepositorySync.repositoryId, event.repository.externalId),
        input.organizationId === undefined
          ? undefined
          : eq(githubRepositorySync.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for('update');
  if (repo === undefined) return { ...EMPTY, ignoredReason: 'repository_not_connected' };
  if (!repo.enabled) return { ...EMPTY, ignoredReason: 'repository_disabled' };

  const now = input.now ?? new Date();
  const mirror = await persistGithubMirror(database, {
    repo,
    event,
    now,
    ...(input.webhookDeliveryId === undefined
      ? {}
      : { webhookDeliveryId: input.webhookDeliveryId }),
  });
  const { pullRequests } = mirror;
  const mirroredPullRequest = pullRequests[0] ?? null;
  const stalePullRequestEvent =
    mirroredPullRequest !== null && pullRequestEventIsStale(event, mirroredPullRequest, now);
  const identifiers = await issueIdentifiers(database, repo, event);
  if (identifiers.length === 0) {
    return await resultWithoutLinkedIssues(database, {
      repo,
      event,
      pullRequests,
      failedTransitionPullRequestIds: mirror.failedTransitionPullRequestIds,
      stalePullRequestEvent,
      now,
      emptyReason: 'no_issue_identifier',
    });
  }

  const issues = await loadLinkedIssues(database, repo.organizationId, identifiers);
  if (issues.length === 0) {
    return await resultWithoutLinkedIssues(database, {
      repo,
      event,
      pullRequests,
      failedTransitionPullRequestIds: mirror.failedTransitionPullRequestIds,
      stalePullRequestEvent,
      now,
      emptyReason: 'no_matching_issue',
    });
  }

  const actor = await resolveActor(database, event);
  const reviewerUserId =
    event.requestedReviewer === null
      ? null
      : await githubAccountUser(database, event.requestedReviewer.id);
  const audiences = await authorizedAudiences(
    database,
    repo.organizationId,
    issues,
    reviewerUserId,
  );

  const actions: SyncAction[] = [];
  const notificationEvents: NotificationEvent[] = [];
  const gitLinks: GitLinkRow[] = [];

  for (const linked of issues) {
    const outcome = await applyToIssue(database, {
      repo,
      event,
      linked,
      actor,
      audienceUserIds: audiences.get(linked.id) ?? [],
      mirroredPullRequest,
      stalePullRequestEvent,
      now,
    });
    actions.push(...outcome.actions);
    notificationEvents.push(...outcome.notificationEvents);
    if (outcome.gitLink !== null) gitLinks.push(outcome.gitLink);
  }

  const canonicalNotifications = await canonicalGithubNotifications(database, notificationEvents, {
    repo,
    event,
    pullRequests,
    now,
    defaultTeamIds: [],
    teamIdsByIssueId: new Map(issues.map((entry) => [entry.id, entry.teamId])),
  });
  const checkNotifications = await githubCheckFailureNotifications(database, {
    repo,
    event,
    pullRequests,
    failedTransitionPullRequestIds: mirror.failedTransitionPullRequestIds,
    actor,
    now,
    issues,
    audiences,
    defaultTeamIds: [],
  });
  return {
    handled: true,
    ignoredReason: null,
    organizationId: repo.organizationId,
    actions,
    notificationEvents: [...canonicalNotifications, ...checkNotifications],
    teamIds: unique(issues.map((entry) => entry.teamId)),
    gitLinks,
    pullRequests,
  };
}

async function resultWithoutLinkedIssues(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly pullRequests: GithubPullRequestRow[];
    readonly failedTransitionPullRequestIds: ReadonlySet<string>;
    readonly stalePullRequestEvent: boolean;
    readonly now: Date;
    readonly emptyReason: Extract<GithubIgnoredReason, 'no_issue_identifier' | 'no_matching_issue'>;
  },
): Promise<GithubApplyResult> {
  const {
    repo,
    event,
    pullRequests,
    failedTransitionPullRequestIds,
    stalePullRequestEvent,
    now,
    emptyReason,
  } = context;
  const notificationEvents = stalePullRequestEvent
    ? []
    : await unlinkedPullRequestNotifications(database, { repo, event, pullRequests });
  const canonicalNotifications = await canonicalGithubNotifications(database, notificationEvents, {
    repo,
    event,
    pullRequests,
    now,
    defaultTeamIds: repo.teamId === null ? [] : [repo.teamId],
    teamIdsByIssueId: new Map(),
  });
  const actor = await resolveActor(database, event);
  const checkNotifications = await githubCheckFailureNotifications(database, {
    repo,
    event,
    pullRequests,
    failedTransitionPullRequestIds,
    actor,
    now,
    issues: [],
    audiences: new Map(),
    defaultTeamIds: repo.teamId === null ? [] : [repo.teamId],
  });
  return {
    ...EMPTY,
    handled: true,
    ignoredReason: pullRequests.length === 0 ? emptyReason : null,
    organizationId: repo.organizationId,
    notificationEvents: [...canonicalNotifications, ...checkNotifications],
    teamIds: repo.teamId === null ? [] : [repo.teamId],
    pullRequests,
  };
}

async function canonicalGithubNotifications(
  database: GithubDatabase,
  notifications: readonly NotificationEvent[],
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly pullRequests: readonly GithubPullRequestRow[];
    readonly now: Date;
    readonly defaultTeamIds: readonly string[];
    readonly teamIdsByIssueId: ReadonlyMap<string, string>;
  },
): Promise<NotificationEvent[]> {
  const { repo, event, pullRequests, now } = context;
  if (notifications.length === 0) return [];
  if (pullRequests.length === 1) {
    const pull = pullRequests[0];
    if (pull === undefined) return [];
    const first = notifications[0];
    if (first === undefined) return [];
    return [
      canonicalGithubNotification(first, notifications, {
        repo,
        event,
        pull,
        now,
        defaultTeamIds: context.defaultTeamIds,
        teamIdsByIssueId: context.teamIdsByIssueId,
      }),
    ];
  }
  const notificationsByPull = await groupGithubNotificationsByPull(
    database,
    notifications,
    repo.organizationId,
    pullRequests.map((pull) => pull.id),
  );
  return pullRequests.flatMap((pull) => {
    const audienceEvents = notificationsByPull.get(pull.id) ?? [];
    const first = audienceEvents[0];
    if (first === undefined) return [];
    return [
      canonicalGithubNotification(first, audienceEvents, {
        repo,
        event,
        pull,
        now,
        defaultTeamIds: context.defaultTeamIds,
        teamIdsByIssueId: context.teamIdsByIssueId,
      }),
    ];
  });
}

async function githubCheckFailureNotifications(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly pullRequests: readonly GithubPullRequestRow[];
    readonly failedTransitionPullRequestIds: ReadonlySet<string>;
    readonly actor: Actor;
    readonly now: Date;
    readonly issues: readonly LinkedIssue[];
    readonly audiences: ReadonlyMap<string, readonly string[]>;
    readonly defaultTeamIds: readonly string[];
  },
): Promise<NotificationEvent[]> {
  const pulls = context.pullRequests.filter((pull) =>
    context.failedTransitionPullRequestIds.has(pull.id),
  );
  if (pulls.length === 0) return [];
  const issueIds = context.issues.map((entry) => entry.id);
  const links =
    issueIds.length === 0
      ? []
      : await database
          .select({ issueId: gitLink.issueId, pullRequestId: gitLink.pullRequestId })
          .from(gitLink)
          .where(
            and(
              eq(gitLink.organizationId, context.repo.organizationId),
              eq(gitLink.provider, 'github'),
              eq(gitLink.kind, 'pull_request'),
              inArray(gitLink.issueId, issueIds),
              inArray(
                gitLink.pullRequestId,
                pulls.map((pull) => pull.id),
              ),
            ),
          )
          .orderBy(asc(gitLink.id))
          .for('update', { of: gitLink });
  const linkedIssueIdsByPull = new Map<string, string[]>();
  for (const link of links) {
    if (link.pullRequestId === null) continue;
    const linkedIssueIds = linkedIssueIdsByPull.get(link.pullRequestId) ?? [];
    linkedIssueIds.push(link.issueId);
    linkedIssueIdsByPull.set(link.pullRequestId, linkedIssueIds);
  }
  const unlinkedCandidates = new Map(
    await Promise.all(
      pulls.map(
        async (pull) =>
          [
            pull.id,
            await unlinkedPullRequestAudience(database, context.event, pull, null),
          ] as const,
      ),
    ),
  );
  const authorizedUnlinked = new Set(
    await authorizedWorkspaceUsers(
      database,
      context.repo.organizationId,
      unique(
        [...unlinkedCandidates.values()].filter((userId): userId is string => userId !== null),
      ),
    ),
  );
  const issueById = new Map(context.issues.map((entry) => [entry.id, entry]));
  const normalized = context.event.checks?.normalized;
  const providerOccurredAt =
    normalized?.kind === 'context'
      ? normalized.providerUpdatedAt
      : context.event.activity.occurredAt;
  const externalUrl = normalized?.kind === 'context' ? normalized.url : '';
  return pulls.map((pull) => {
    const linkedIssueIds = linkedIssueIdsByPull.get(pull.id) ?? [];
    const linkedUserIds = linkedIssueIds.flatMap((issueId) => context.audiences.get(issueId) ?? []);
    const unlinkedCandidate = unlinkedCandidates.get(pull.id) ?? null;
    const userIds = checkFailureUserIds(linkedUserIds, unlinkedCandidate, authorizedUnlinked);
    const teamIds = unique([
      ...context.defaultTeamIds,
      ...linkedIssueIds.flatMap((issueId) => {
        const linked = issueById.get(issueId);
        return linked === undefined ? [] : [linked.teamId];
      }),
    ]);
    return {
      organizationId: context.repo.organizationId,
      type: 'pr_checks_failed',
      reason: 'subscribed',
      actor: context.actor,
      entityType: 'github_pull_request',
      entityId: pull.id,
      userIds,
      title: `Checks failed on ${pull.title}`,
      body: `${context.repo.repositoryName}#${pull.number}`,
      url: `/pulls/${pull.id}`,
      externalUrl: externalUrl.length > 0 ? externalUrl : pull.url,
      source: {
        sourceEventKey: `github-pr:${context.repo.repositoryId}:${pull.number}:${pull.headSha}:checks-failed`,
        subjectType: 'github_pull_request',
        subjectKey: `github-pr:${context.repo.repositoryId}:${pull.number}`,
        occurredAt: eventDate(providerOccurredAt, context.now),
        teamIds,
        payload: {
          action: context.event.action,
          headSha: pull.headSha,
          repository: context.event.repository,
          pullRequestId: pull.id,
          pullRequestNumber: pull.number,
        },
      },
    };
  });
}

function checkFailureUserIds(
  linkedUserIds: readonly string[],
  unlinkedCandidate: string | null,
  authorizedUnlinked: ReadonlySet<string>,
): string[] {
  const authorIds =
    unlinkedCandidate !== null && authorizedUnlinked.has(unlinkedCandidate)
      ? [unlinkedCandidate]
      : [];
  return unique([...linkedUserIds, ...authorIds]);
}

async function groupGithubNotificationsByPull(
  database: GithubDatabase,
  notifications: readonly NotificationEvent[],
  organizationId: string,
  pullIds: readonly string[],
): Promise<Map<string, NotificationEvent[]>> {
  const pullIdSet = new Set(pullIds);
  const issueIds = unique(
    notifications.flatMap((notification) =>
      notification.entityType === 'issue' ? [notification.entityId] : [],
    ),
  );
  const links =
    issueIds.length === 0
      ? []
      : await database
          .select({ issueId: gitLink.issueId, pullRequestId: gitLink.pullRequestId })
          .from(gitLink)
          .where(
            and(
              eq(gitLink.organizationId, organizationId),
              eq(gitLink.provider, 'github'),
              eq(gitLink.kind, 'pull_request'),
              inArray(gitLink.issueId, issueIds),
              inArray(gitLink.pullRequestId, pullIds),
            ),
          )
          .orderBy(asc(gitLink.id))
          .for('update', { of: gitLink });
  const pullIdsByIssue = new Map<string, Set<string>>();
  for (const link of links) {
    if (link.pullRequestId === null) continue;
    const ids = pullIdsByIssue.get(link.issueId) ?? new Set<string>();
    ids.add(link.pullRequestId);
    pullIdsByIssue.set(link.issueId, ids);
  }
  const notificationsByPull = new Map<string, NotificationEvent[]>();
  for (const notification of notifications) {
    const targetPullIds =
      notification.entityType === 'github_pull_request'
        ? [notification.entityId]
        : [...(pullIdsByIssue.get(notification.entityId) ?? [])];
    for (const pullId of targetPullIds) {
      if (!pullIdSet.has(pullId)) continue;
      const grouped = notificationsByPull.get(pullId) ?? [];
      grouped.push(notification);
      notificationsByPull.set(pullId, grouped);
    }
  }
  return notificationsByPull;
}

function canonicalGithubNotification(
  notification: NotificationEvent,
  audienceEvents: readonly NotificationEvent[],
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly pull: GithubPullRequestRow;
    readonly now: Date;
    readonly defaultTeamIds: readonly string[];
    readonly teamIdsByIssueId: ReadonlyMap<string, string>;
  },
): NotificationEvent {
  const { repo, event, pull, now } = context;
  return {
    ...notification,
    entityType: 'github_pull_request',
    entityId: pull.id,
    userIds: unique(audienceEvents.flatMap((candidate) => candidate.userIds)),
    url: `/pulls/${pull.id}`,
    source: {
      sourceEventKey: `github:${repo.repositoryId}:pr:${pull.number}:${event.activity.externalId}`,
      subjectType: 'github_pull_request',
      subjectKey: `github-pr:${repo.repositoryId}:${pull.number}`,
      occurredAt: new Date(event.activity.occurredAt ?? now),
      teamIds: unique([
        ...context.defaultTeamIds,
        ...audienceEvents.flatMap((candidate) => {
          if (candidate.entityType !== 'issue') return [];
          const teamId = context.teamIdsByIssueId.get(candidate.entityId);
          return teamId === undefined ? [] : [teamId];
        }),
      ]),
      payload: {
        action: event.action,
        activity: event.activity,
        repository: event.repository,
        pullRequestId: pull.id,
        pullRequestNumber: pull.number,
      },
    },
  };
}

function pullRequestEventIsStale(
  event: NormalizedGithubEvent,
  pull: GithubPullRequestRow,
  now: Date,
): boolean {
  if (event.pullRequest === null) return false;
  const occurredAt = eventDate(event.activity.occurredAt ?? event.pullRequest.updatedAt, now);
  return occurredAt.getTime() < pull.lastEventAt.getTime();
}

function eventDate(value: string | null, fallback: Date): Date {
  if (value === null) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

async function persistGithubMirror(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly now: Date;
    readonly webhookDeliveryId?: string;
  },
): Promise<GithubMirrorOutcome> {
  const { repo, event, now } = context;
  if (event.pullRequest !== null) {
    await lockPullRequestHeadOwners(database, { repo, event, now });
    const upserted = await upsertMirroredPullRequest(database, context);
    if (upserted === null) {
      return { pullRequests: [], failedTransitionPullRequestIds: new Set() };
    }
    const { row } = upserted;
    await upsertPullRequestActivity(database, { row, event, now });
    const bound = await bindCurrentHeadContexts(database, { repo, pull: row, now });
    const newlyMirroredActive =
      upserted.created &&
      !bound.pull.merged &&
      bound.pull.state !== 'closed' &&
      bound.pull.state !== 'merged' &&
      COMMIT_SHA_PATTERN.test(bound.pull.headSha);
    if (upserted.headChanged || newlyMirroredActive) {
      await enqueueHeadReconciliation(database, {
        repo,
        headSha: bound.pull.headSha,
        triggerKind: upserted.headChanged ? 'pull_request_head_changed' : 'pull_request_mirrored',
        triggerIdentity: `${bound.pull.number}:${bound.pull.headEpoch}`,
        now,
      });
    }
    return {
      pullRequests: [bound.pull],
      failedTransitionPullRequestIds: bound.failed ? new Set([row.id]) : new Set(),
    };
  }
  const normalized = event.checks?.normalized;
  if (normalized === null || normalized === undefined) {
    return { pullRequests: [], failedTransitionPullRequestIds: new Set() };
  }
  if (normalized.kind === 'reconciliation_trigger') {
    await enqueueHeadReconciliation(database, {
      repo,
      headSha: normalized.headSha,
      triggerKind: normalized.sourceKind,
      triggerIdentity: normalized.providerObjectId,
      now,
    });
    return { pullRequests: [], failedTransitionPullRequestIds: new Set() };
  }
  if (context.webhookDeliveryId === undefined) {
    throw new Error('GitHub check activity requires webhook delivery provenance.');
  }
  return await applyDirectCheckContext(database, {
    repo,
    check: normalized,
    webhookDeliveryId: context.webhookDeliveryId,
    now,
  });
}

async function lockPullRequestHeadOwners(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly now: Date;
  },
): Promise<void> {
  const pullRequest = context.event.pullRequest;
  if (pullRequest === null) return;
  const [existing] = await database
    .select({ headSha: githubPullRequest.headSha })
    .from(githubPullRequest)
    .where(
      and(
        eq(githubPullRequest.repositorySyncId, context.repo.id),
        eq(githubPullRequest.number, pullRequest.number),
      ),
    )
    .limit(1);
  const headShas = unique([existing?.headSha ?? '', pullRequest.headSha])
    .filter((headSha) => headSha.length > 0)
    .sort();
  for (const headSha of headShas) {
    await lockedHeadReconciliation(database, {
      repo: context.repo,
      headSha,
      triggerKind: 'pull_request_head_owner',
      triggerIdentity: `${pullRequest.number}:${headSha}`,
      now: context.now,
    });
  }
}

function aggregateCheckStates(states: readonly string[]): string {
  if (states.includes('failure')) return 'failure';
  if (states.includes('pending')) return 'pending';
  if (states.length > 0 && states.every((state) => state === 'success')) return 'success';
  return 'unknown';
}

async function lockedHeadReconciliation(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly headSha: string;
    readonly triggerKind: string;
    readonly triggerIdentity: string;
    readonly now: Date;
  },
) {
  await database
    .insert(githubCheckHeadReconciliation)
    .values({
      id: randomUUIDv7(),
      organizationId: context.repo.organizationId,
      repositorySyncId: context.repo.id,
      headSha: context.headSha,
      status: 'completed',
      triggerKind: context.triggerKind,
      triggerIdentity: context.triggerIdentity,
      availableAt: context.now,
      updatedAt: context.now,
    })
    .onConflictDoNothing();
  const [head] = await database
    .select()
    .from(githubCheckHeadReconciliation)
    .where(
      and(
        eq(githubCheckHeadReconciliation.organizationId, context.repo.organizationId),
        eq(githubCheckHeadReconciliation.repositorySyncId, context.repo.id),
        eq(githubCheckHeadReconciliation.headSha, context.headSha),
      ),
    )
    .limit(1)
    .for('update');
  if (head === undefined) throw new Error('GitHub head reconciliation row was not created.');
  return head;
}

async function enqueueHeadReconciliation(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly headSha: string;
    readonly triggerKind: string;
    readonly triggerIdentity: string;
    readonly now: Date;
  },
): Promise<void> {
  const head = await lockedHeadReconciliation(database, context);
  const processing = head.status === 'processing';
  await database
    .update(githubCheckHeadReconciliation)
    .set({
      status: processing ? 'processing' : 'pending',
      jobVersion: head.jobVersion + 1,
      triggerKind: context.triggerKind,
      triggerIdentity: context.triggerIdentity,
      attempts: 0,
      availableAt: context.now,
      settleDeadline: null,
      rerunRequired: processing,
      lastError: null,
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

function directCheckProviderDate(check: NormalizedGithubCheckContext, now: Date): Date {
  return eventDate(check.providerUpdatedAt, now);
}

async function insertDirectCheckActivity(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly check: NormalizedGithubCheckContext;
    readonly webhookDeliveryId: string;
    readonly now: Date;
  },
) {
  const providerUpdatedAt = directCheckProviderDate(context.check, context.now);
  const values = {
    id: randomUUIDv7(),
    organizationId: context.repo.organizationId,
    repositorySyncId: context.repo.id,
    headSha: context.check.headSha,
    sourceKind: context.check.sourceKind,
    contextKey: context.check.contextKey,
    providerObjectId: context.check.providerObjectId,
    providerRunId: context.check.sourceKind === 'check_run' ? context.check.providerObjectId : null,
    providerUpdatedAt,
    webhookDeliveryId: context.webhookDeliveryId,
    state: context.check.state,
    payload: {
      appId: context.check.appId,
      conclusion: context.check.conclusion,
      context: context.check.providerContext,
      creator: context.check.creator,
      status: context.check.status,
      url: context.check.url,
    },
    occurredAt: providerUpdatedAt,
  };
  const [inserted] = await database
    .insert(githubCheckActivity)
    .values(values)
    .onConflictDoNothing()
    .returning();
  if (inserted !== undefined) return inserted;
  const [existing] = await database
    .select()
    .from(githubCheckActivity)
    .where(
      and(
        eq(githubCheckActivity.organizationId, context.repo.organizationId),
        eq(githubCheckActivity.repositorySyncId, context.repo.id),
        eq(githubCheckActivity.webhookDeliveryId, context.webhookDeliveryId),
        eq(githubCheckActivity.sourceKind, context.check.sourceKind),
        eq(githubCheckActivity.providerObjectId, context.check.providerObjectId),
        eq(githubCheckActivity.providerUpdatedAt, providerUpdatedAt),
      ),
    )
    .limit(1);
  if (existing === undefined) throw new Error('GitHub check activity conflict was unresolved.');
  return existing;
}

async function applyDirectCheckContext(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly check: NormalizedGithubCheckContext;
    readonly webhookDeliveryId: string;
    readonly now: Date;
  },
): Promise<GithubMirrorOutcome> {
  const head = await lockedHeadReconciliation(database, {
    repo: context.repo,
    headSha: context.check.headSha,
    triggerKind: 'direct_context',
    triggerIdentity: `${context.check.sourceKind}:${context.check.providerObjectId}`,
    now: context.now,
  });
  const activity = await insertDirectCheckActivity(database, context);
  const contexts = await database
    .select()
    .from(githubCheckHeadContext)
    .where(
      and(
        eq(githubCheckHeadContext.organizationId, context.repo.organizationId),
        eq(githubCheckHeadContext.repositorySyncId, context.repo.id),
        eq(githubCheckHeadContext.headSha, context.check.headSha),
      ),
    )
    .orderBy(asc(githubCheckHeadContext.contextKey))
    .for('update');
  const current = contexts.find((entry) => entry.contextKey === context.check.contextKey);
  const providerUpdatedAt = directCheckProviderDate(context.check, context.now);
  if (current !== undefined && providerUpdatedAt.getTime() < current.providerUpdatedAt.getTime()) {
    return { pullRequests: [], failedTransitionPullRequestIds: new Set() };
  }
  if (
    current !== undefined &&
    providerUpdatedAt.getTime() === current.providerUpdatedAt.getTime() &&
    current.state !== context.check.state
  ) {
    await database
      .update(githubCheckHeadContext)
      .set({ reconciliationState: 'unresolved', updatedAt: context.now })
      .where(eq(githubCheckHeadContext.id, current.id));
    await enqueueHeadReconciliation(database, {
      repo: context.repo,
      headSha: context.check.headSha,
      triggerKind: 'context_conflict',
      triggerIdentity: activity.id,
      now: context.now,
    });
    return { pullRequests: [], failedTransitionPullRequestIds: new Set() };
  }
  if (
    current !== undefined &&
    providerUpdatedAt.getTime() === current.providerUpdatedAt.getTime() &&
    current.state === context.check.state
  ) {
    return { pullRequests: [], failedTransitionPullRequestIds: new Set() };
  }
  const renamed = contexts.find(
    (entry) =>
      entry.sourceKind === 'check_run' &&
      context.check.sourceKind === 'check_run' &&
      entry.latestProviderObjectId === context.check.providerObjectId &&
      entry.contextKey !== context.check.contextKey &&
      entry.active,
  );
  if (renamed !== undefined) {
    await database
      .update(githubCheckHeadContext)
      .set({ reconciliationState: 'unresolved', active: false, updatedAt: context.now })
      .where(eq(githubCheckHeadContext.id, renamed.id));
    await enqueueHeadReconciliation(database, {
      repo: context.repo,
      headSha: context.check.headSha,
      triggerKind: 'context_identity_changed',
      triggerIdentity: activity.id,
      now: context.now,
    });
    return { pullRequests: [], failedTransitionPullRequestIds: new Set() };
  }
  const contextVersion = (current?.contextVersion ?? 0) + 1;
  const contextValues = {
    sourceKind: context.check.sourceKind,
    state: context.check.state,
    providerUpdatedAt,
    latestProviderObjectId: context.check.providerObjectId,
    latestProviderRunId:
      context.check.sourceKind === 'check_run' ? context.check.providerObjectId : null,
    active: true,
    contextVersion,
    latestActivityId: activity.id,
    reconciliationState: 'resolved',
    updatedAt: context.now,
  };
  const [headContext] = await database
    .insert(githubCheckHeadContext)
    .values({
      id: current?.id ?? randomUUIDv7(),
      organizationId: context.repo.organizationId,
      repositorySyncId: context.repo.id,
      headSha: context.check.headSha,
      contextKey: context.check.contextKey,
      ...contextValues,
    })
    .onConflictDoUpdate({
      target: [
        githubCheckHeadContext.organizationId,
        githubCheckHeadContext.repositorySyncId,
        githubCheckHeadContext.headSha,
        githubCheckHeadContext.contextKey,
      ],
      set: contextValues,
    })
    .returning();
  if (headContext === undefined) throw new Error('GitHub head context was not persisted.');
  await database
    .update(githubCheckHeadReconciliation)
    .set({ contextGeneration: head.contextGeneration + 1, updatedAt: context.now })
    .where(eq(githubCheckHeadReconciliation.id, head.id));
  return await projectHeadContext(database, {
    repo: context.repo,
    headIsAuthoritative: head.status === 'completed' || head.acceptedFetchAttemptId !== null,
    headContext,
    now: context.now,
  });
}

async function projectHeadContext(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly headIsAuthoritative: boolean;
    readonly headContext: typeof githubCheckHeadContext.$inferSelect;
    readonly now: Date;
  },
): Promise<GithubMirrorOutcome> {
  const pulls = await database
    .select()
    .from(githubPullRequest)
    .where(
      and(
        eq(githubPullRequest.organizationId, context.repo.organizationId),
        eq(githubPullRequest.repositorySyncId, context.repo.id),
        eq(githubPullRequest.headSha, context.headContext.headSha),
      ),
    )
    .orderBy(asc(githubPullRequest.id))
    .for('update');
  const updatedPulls: GithubPullRequestRow[] = [];
  const failed = new Set<string>();
  for (const pull of pulls) {
    await upsertPullRequestCheckProjection(database, {
      repo: context.repo,
      pull,
      headContext: context.headContext,
      now: context.now,
    });
    const result = await refreshPullRequestCheckStatus(database, {
      pull,
      allowNonFailure: context.headIsAuthoritative,
      now: context.now,
    });
    updatedPulls.push(result.pull);
    if (result.failed) failed.add(pull.id);
  }
  return { pullRequests: updatedPulls, failedTransitionPullRequestIds: failed };
}

async function upsertPullRequestCheckProjection(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly pull: GithubPullRequestRow;
    readonly headContext: typeof githubCheckHeadContext.$inferSelect;
    readonly now: Date;
  },
): Promise<void> {
  const values = {
    headContextId: context.headContext.id,
    headSha: context.headContext.headSha,
    projectedContextVersion: context.headContext.contextVersion,
    projectedState: context.headContext.state,
    latestActivityId: context.headContext.latestActivityId,
    updatedAt: context.now,
  };
  await database
    .insert(githubPullRequestCheckContext)
    .values({
      id: randomUUIDv7(),
      organizationId: context.repo.organizationId,
      repositorySyncId: context.repo.id,
      pullRequestId: context.pull.id,
      contextKey: context.headContext.contextKey,
      capturedHeadEpoch: context.pull.headEpoch,
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

async function refreshPullRequestCheckStatus(
  database: GithubDatabase,
  context: {
    readonly pull: GithubPullRequestRow;
    readonly allowNonFailure: boolean;
    readonly now: Date;
  },
): Promise<{ readonly pull: GithubPullRequestRow; readonly failed: boolean }> {
  const projections = await database
    .select({ state: githubPullRequestCheckContext.projectedState })
    .from(githubPullRequestCheckContext)
    .where(
      and(
        eq(githubPullRequestCheckContext.organizationId, context.pull.organizationId),
        eq(githubPullRequestCheckContext.pullRequestId, context.pull.id),
        eq(githubPullRequestCheckContext.capturedHeadEpoch, context.pull.headEpoch),
        eq(githubPullRequestCheckContext.headSha, context.pull.headSha),
      ),
    );
  const projectedCheckStatus = aggregateCheckStates(projections.map((entry) => entry.state));
  const checkStatus =
    context.allowNonFailure || projectedCheckStatus === 'failure'
      ? projectedCheckStatus
      : context.pull.checkStatus;
  const [pull] = await database
    .update(githubPullRequest)
    .set({ checkStatus, syncId: nextSyncId, updatedAt: context.now })
    .where(
      and(
        eq(githubPullRequest.id, context.pull.id),
        eq(githubPullRequest.headEpoch, context.pull.headEpoch),
        eq(githubPullRequest.headSha, context.pull.headSha),
      ),
    )
    .returning();
  if (pull === undefined) throw new Error('GitHub pull request head changed during projection.');
  return {
    pull,
    failed: context.pull.checkStatus !== 'failure' && checkStatus === 'failure',
  };
}

async function bindCurrentHeadContexts(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly pull: GithubPullRequestRow;
    readonly now: Date;
  },
): Promise<{ readonly pull: GithubPullRequestRow; readonly failed: boolean }> {
  if (context.pull.headSha.length === 0) return { pull: context.pull, failed: false };
  const [head] = await database
    .select()
    .from(githubCheckHeadReconciliation)
    .where(
      and(
        eq(githubCheckHeadReconciliation.organizationId, context.repo.organizationId),
        eq(githubCheckHeadReconciliation.repositorySyncId, context.repo.id),
        eq(githubCheckHeadReconciliation.headSha, context.pull.headSha),
      ),
    )
    .limit(1)
    .for('update');
  if (head === undefined || !headAllowsContextBinding(head)) {
    return { pull: context.pull, failed: false };
  }
  const contexts = await database
    .select()
    .from(githubCheckHeadContext)
    .where(
      and(
        eq(githubCheckHeadContext.organizationId, context.repo.organizationId),
        eq(githubCheckHeadContext.repositorySyncId, context.repo.id),
        eq(githubCheckHeadContext.headSha, context.pull.headSha),
        eq(githubCheckHeadContext.active, true),
        eq(githubCheckHeadContext.reconciliationState, 'resolved'),
      ),
    )
    .orderBy(asc(githubCheckHeadContext.contextKey))
    .for('update');
  if (contexts.length === 0) return { pull: context.pull, failed: false };
  for (const headContext of contexts) {
    await upsertPullRequestCheckProjection(database, {
      repo: context.repo,
      pull: context.pull,
      headContext,
      now: context.now,
    });
  }
  return await refreshPullRequestCheckStatus(database, {
    pull: context.pull,
    allowNonFailure: true,
    now: context.now,
  });
}

function headAllowsContextBinding(
  head: typeof githubCheckHeadReconciliation.$inferSelect,
): boolean {
  if (head.status !== 'completed' || head.rerunRequired) return false;
  if (head.acceptedFetchAttemptId === null) return true;
  if (head.acceptedJobVersion !== head.jobVersion) return false;
  if (head.acceptedContextGeneration === null) return false;
  return head.contextGeneration >= head.acceptedContextGeneration;
}

function retainedValue<T>(retain: boolean, existing: T | undefined, incoming: T): T {
  if (retain && existing !== undefined) return existing;
  return incoming;
}

function latestText(stale: boolean, existing: string | undefined, incoming: string): string {
  if (stale && existing !== undefined) return existing;
  if (incoming.length > 0) return incoming;
  return existing ?? '';
}

function githubDate(
  value: string | null,
  existing: Date | null | undefined,
  now: Date,
): Date | null {
  if (value === null) return existing ?? null;
  return eventDate(value, now);
}

function mirroredReviewDecision(
  event: NormalizedGithubEvent,
  existing: GithubPullRequestRow | undefined,
  stale: boolean,
): string | null {
  if (stale) return existing?.reviewDecision ?? null;
  if (event.review?.decision === 'dismissed') return null;
  return event.review?.decision ?? existing?.reviewDecision ?? null;
}

function mirroredState(
  retainSnapshot: boolean,
  existing: GithubPullRequestRow | undefined,
  pr: NonNullable<NormalizedGithubEvent['pullRequest']>,
  reviewDecision: string | null,
): string {
  if (retainSnapshot) return existing?.state ?? 'open';
  const review =
    reviewDecision === 'approved' || reviewDecision === 'changes_requested' ? reviewDecision : null;
  return pullRequestState({
    draft: pr.draft,
    merged: pr.merged,
    closed: pr.closed,
    review,
  });
}

function mirroredPullRequestSnapshotDecision(
  existing: GithubPullRequestRow | undefined,
  pr: NonNullable<NormalizedGithubEvent['pullRequest']>,
  occurredAt: Date,
) {
  const staleActivity =
    existing !== undefined && occurredAt.getTime() < existing.lastEventAt.getTime();
  const complete = pr.externalId.length > 0 || pr.nodeId.length > 0 || pr.headRef.length > 0;
  const providerUpdatedAt =
    complete && pr.updatedAt !== null ? eventDate(pr.updatedAt, occurredAt) : null;
  const staleProviderSnapshot =
    existing !== undefined &&
    providerUpdatedAt !== null &&
    existing.providerUpdatedAt !== null &&
    providerUpdatedAt.getTime() < existing.providerUpdatedAt.getTime();
  const equalTimeHeadConflict =
    existing !== undefined &&
    complete &&
    pr.headSha.length > 0 &&
    existing.headSha.length > 0 &&
    pr.headSha !== existing.headSha &&
    providerUpdatedAt !== null &&
    existing.providerUpdatedAt !== null &&
    providerUpdatedAt.getTime() === existing.providerUpdatedAt.getTime();
  const retain = staleProviderSnapshot || !complete || equalTimeHeadConflict;
  const headChanged =
    existing !== undefined &&
    !retain &&
    COMMIT_SHA_PATTERN.test(pr.headSha) &&
    pr.headSha !== existing.headSha;
  return { staleActivity, providerUpdatedAt, equalTimeHeadConflict, retain, headChanged };
}

function mirroredPullRequestAuthor(
  existing: GithubPullRequestRow | undefined,
  pr: NonNullable<NormalizedGithubEvent['pullRequest']>,
): { readonly authorLogin: string; readonly authorId: string } {
  if (pr.author !== null) {
    return { authorLogin: pr.author.login, authorId: String(pr.author.id) };
  }
  return { authorLogin: existing?.authorLogin ?? '', authorId: existing?.authorId ?? '' };
}

async function finalizeMirroredPullRequest(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly existing: GithubPullRequestRow | undefined;
    readonly row: GithubPullRequestRow;
    readonly incomingHeadSha: string;
    readonly providerUpdatedAt: Date | null;
    readonly equalTimeHeadConflict: boolean;
    readonly headChanged: boolean;
    readonly now: Date;
  },
): Promise<MirroredPullRequestUpsert> {
  if (
    context.equalTimeHeadConflict &&
    context.existing !== undefined &&
    context.providerUpdatedAt !== null
  ) {
    await enqueuePullRequestReconciliation(database, {
      pull: context.existing,
      incomingHeadSha: context.incomingHeadSha,
      providerUpdatedAt: context.providerUpdatedAt,
      triggerIdentity: context.event.activity.externalId,
      now: context.now,
    });
  }
  return {
    row: context.row,
    headChanged: context.headChanged,
    created: context.existing === undefined,
  };
}

async function upsertMirroredPullRequest(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly now: Date;
  },
): Promise<MirroredPullRequestUpsert | null> {
  const { repo, event, now } = context;
  const pr = event.pullRequest;
  if (pr === null) return null;
  const [existing] = await database
    .select()
    .from(githubPullRequest)
    .where(
      and(eq(githubPullRequest.repositorySyncId, repo.id), eq(githubPullRequest.number, pr.number)),
    )
    .limit(1)
    .for('update');
  const occurredAt = eventDate(event.activity.occurredAt ?? pr.updatedAt, now);
  const snapshot = mirroredPullRequestSnapshotDecision(existing, pr, occurredAt);
  const reviewDecision = mirroredReviewDecision(event, existing, snapshot.staleActivity);
  const state = mirroredState(snapshot.retain, existing, pr, reviewDecision);
  const author = mirroredPullRequestAuthor(existing, pr);
  const values = {
    repositoryId: event.repository.externalId,
    repositoryName: repo.repositoryName,
    number: pr.number,
    nodeId: latestText(snapshot.retain, existing?.nodeId, pr.nodeId),
    title: latestText(snapshot.retain, existing?.title, pr.title),
    body: retainedValue(snapshot.retain, existing?.body, pr.body),
    url: latestText(snapshot.retain, existing?.url, pr.url),
    headRef: retainedValue(snapshot.retain, existing?.headRef, pr.headRef),
    headSha: retainedValue(snapshot.retain, existing?.headSha, pr.headSha),
    headEpoch: snapshot.headChanged ? (existing?.headEpoch ?? 0) + 1 : (existing?.headEpoch ?? 0),
    providerUpdatedAt: retainedValue(
      snapshot.retain,
      existing?.providerUpdatedAt,
      snapshot.providerUpdatedAt,
    ),
    baseRef: retainedValue(snapshot.retain, existing?.baseRef, pr.baseRef),
    state,
    draft: retainedValue(snapshot.retain, existing?.draft, pr.draft),
    merged: retainedValue(snapshot.retain, existing?.merged, pr.merged),
    authorLogin: author.authorLogin,
    authorId: author.authorId,
    reviewDecision,
    checkStatus: snapshot.headChanged ? 'unknown' : (existing?.checkStatus ?? 'unknown'),
    githubCreatedAt: githubDate(pr.createdAt, existing?.githubCreatedAt, now),
    githubUpdatedAt: retainedValue(
      snapshot.retain,
      existing?.githubUpdatedAt,
      githubDate(pr.updatedAt, existing?.githubUpdatedAt, now),
    ),
    lastEventAt: retainedValue(snapshot.staleActivity, existing?.lastEventAt, occurredAt),
    syncId: nextSyncId,
    updatedAt: now,
  };
  const [row] = await database
    .insert(githubPullRequest)
    .values({
      id: existing?.id ?? randomUUIDv7(),
      organizationId: repo.organizationId,
      repositorySyncId: repo.id,
      ...values,
    })
    .onConflictDoUpdate({
      target: [githubPullRequest.repositorySyncId, githubPullRequest.number],
      set: values,
    })
    .returning();
  if (row !== undefined) {
    return await finalizeMirroredPullRequest(database, {
      repo,
      event,
      existing,
      row,
      incomingHeadSha: pr.headSha,
      providerUpdatedAt: snapshot.providerUpdatedAt,
      equalTimeHeadConflict: snapshot.equalTimeHeadConflict,
      headChanged: snapshot.headChanged,
      now,
    });
  }
  const [current] = await database
    .select()
    .from(githubPullRequest)
    .where(
      and(eq(githubPullRequest.repositorySyncId, repo.id), eq(githubPullRequest.number, pr.number)),
    )
    .limit(1);
  return current === undefined ? null : { row: current, headChanged: false, created: false };
}

async function enqueuePullRequestReconciliation(
  database: GithubDatabase,
  context: {
    readonly pull: GithubPullRequestRow;
    readonly incomingHeadSha: string;
    readonly providerUpdatedAt: Date;
    readonly triggerIdentity: string;
    readonly now: Date;
  },
): Promise<void> {
  const [existing] = await database
    .select()
    .from(githubPullRequestReconciliation)
    .where(
      and(
        eq(githubPullRequestReconciliation.organizationId, context.pull.organizationId),
        eq(githubPullRequestReconciliation.pullRequestId, context.pull.id),
      ),
    )
    .limit(1)
    .for('update');
  const conflictingHeadShas = unique([
    ...(existing?.conflictingHeadShas ?? []),
    context.pull.headSha,
    context.incomingHeadSha,
  ]).sort();
  const values = {
    status: 'pending',
    jobVersion: (existing?.jobVersion ?? 0) + 1,
    attempts: 0,
    capturedHeadEpoch: context.pull.headEpoch,
    conflictingHeadShas,
    conflictingProviderUpdatedAt: context.providerUpdatedAt,
    triggerIdentity: context.triggerIdentity,
    availableAt: context.now,
    claimToken: null,
    claimedAt: null,
    leaseExpiresAt: null,
    claimedJobVersion: null,
    claimedHeadEpoch: null,
    resolvedHeadSha: null,
    resolvedProviderUpdatedAt: null,
    lastError: null,
    updatedAt: context.now,
  };
  await database
    .insert(githubPullRequestReconciliation)
    .values({
      id: existing?.id ?? randomUUIDv7(),
      organizationId: context.pull.organizationId,
      repositorySyncId: context.pull.repositorySyncId,
      pullRequestId: context.pull.id,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        githubPullRequestReconciliation.organizationId,
        githubPullRequestReconciliation.pullRequestId,
      ],
      set: values,
    });
}

async function upsertPullRequestActivity(
  database: GithubDatabase,
  context: {
    readonly row: GithubPullRequestRow;
    readonly event: NormalizedGithubEvent;
    readonly now: Date;
  },
): Promise<void> {
  const { row, event, now } = context;
  const activity = event.activity;
  const occurredAt = eventDate(activity.occurredAt, now);
  const values = {
    type: activity.type,
    action: event.action,
    actorLogin: event.sender.login,
    actorId: String(event.sender.id),
    body: activity.body,
    url: activity.url,
    state: activity.state,
    path: activity.path,
    line: activity.line,
    occurredAt,
    syncId: nextSyncId,
    updatedAt: now,
  };
  await database
    .insert(githubPullRequestActivity)
    .values({
      id: randomUUIDv7(),
      organizationId: row.organizationId,
      pullRequestId: row.id,
      externalId: activity.externalId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [githubPullRequestActivity.pullRequestId, githubPullRequestActivity.externalId],
      set: values,
      setWhere: lte(githubPullRequestActivity.occurredAt, occurredAt),
    });
}

interface CheckStatusEntry {
  readonly externalId: string;
  readonly type: string;
  readonly body: string;
  readonly state: string;
  readonly occurredAt: string | Date;
}

function checkStatusKey(entry: CheckStatusEntry): string {
  const name = entry.body.trim().toLowerCase();
  if (name.length > 0) return name;
  if (entry.externalId.startsWith('check_suite:')) {
    return entry.externalId.split(':').slice(0, 2).join(':');
  }
  return entry.externalId;
}

function checkOccurredAt(entry: CheckStatusEntry): number {
  const value = entry.occurredAt instanceof Date ? entry.occurredAt : new Date(entry.occurredAt);
  return value.getTime();
}

function rolledUpCheckStatus(entries: readonly CheckStatusEntry[]): string | null {
  const checks = entries.filter((entry) => entry.type === 'checks');
  if (checks.length === 0) return null;
  const latestByName = new Map<string, CheckStatusEntry>();
  for (const entry of checks) {
    const key = checkStatusKey(entry);
    const current = latestByName.get(key);
    const entryTime = checkOccurredAt(entry);
    const currentTime = current === undefined ? Number.NEGATIVE_INFINITY : checkOccurredAt(current);
    if (
      current === undefined ||
      entryTime > currentTime ||
      (entryTime === currentTime && entry.externalId > current.externalId)
    ) {
      latestByName.set(key, entry);
    }
  }
  const states = [...latestByName.values()].map((entry) => entry.state.toLowerCase());
  if (
    states.some((state) =>
      [
        'failure',
        'error',
        'timed_out',
        'cancelled',
        'action_required',
        'startup_failure',
        'stale',
      ].includes(state),
    )
  ) {
    return 'failure';
  }
  if (
    states.some((state) =>
      ['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(state),
    )
  ) {
    return 'pending';
  }
  return states.every((state) => ['success', 'neutral', 'skipped'].includes(state))
    ? 'success'
    : 'unknown';
}

interface PersistedHistoryEntry extends CheckStatusEntry {
  readonly actorId: string;
  readonly actorLogin: string;
}

function historyReviewDecision(
  entries: readonly PersistedHistoryEntry[],
  current: string | null,
): string | null {
  const decisions = entries
    .filter(
      (entry) =>
        entry.type === 'review' &&
        ['approved', 'changes_requested', 'dismissed'].includes(entry.state.toLowerCase()),
    )
    .sort((left, right) => checkOccurredAt(left) - checkOccurredAt(right));
  if (decisions.length === 0) return current;

  const byReviewer = new Map<string, string>();
  for (const entry of decisions) {
    const reviewer = entry.actorId === '0' ? `login:${entry.actorLogin}` : `id:${entry.actorId}`;
    const decision = entry.state.toLowerCase();
    if (decision === 'dismissed') byReviewer.delete(reviewer);
    else byReviewer.set(reviewer, decision);
  }
  const active = [...byReviewer.values()];
  if (active.includes('changes_requested')) return 'changes_requested';
  if (active.includes('approved')) return 'approved';
  return null;
}

export async function upsertGithubPullRequestHistory(
  database: GithubDatabase,
  input: {
    readonly organizationId: string;
    readonly pullRequestId: string;
    readonly entries: readonly GithubPullRequestHistoryEntry[];
    readonly now?: Date;
  },
): Promise<number> {
  const now = input.now ?? new Date();
  const [pull] = await database
    .select()
    .from(githubPullRequest)
    .where(
      and(
        eq(githubPullRequest.id, input.pullRequestId),
        eq(githubPullRequest.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (pull === undefined) return 0;

  for (const entry of input.entries) {
    const occurredAt = eventDate(entry.occurredAt, now);
    const values = {
      type: entry.type,
      action: entry.type === 'review' ? 'submitted' : 'created',
      actorLogin: entry.actor.login,
      actorId: String(entry.actor.id),
      body: entry.body,
      url: entry.url,
      state: entry.state,
      path: entry.path,
      line: entry.line,
      occurredAt,
      syncId: nextSyncId,
      updatedAt: now,
    };
    await database
      .insert(githubPullRequestActivity)
      .values({
        id: randomUUIDv7(),
        organizationId: input.organizationId,
        pullRequestId: input.pullRequestId,
        externalId: entry.externalId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [githubPullRequestActivity.pullRequestId, githubPullRequestActivity.externalId],
        set: values,
        setWhere: lte(githubPullRequestActivity.occurredAt, occurredAt),
      });
  }

  const persistedHistory = await database
    .select({
      externalId: githubPullRequestActivity.externalId,
      type: githubPullRequestActivity.type,
      actorLogin: githubPullRequestActivity.actorLogin,
      actorId: githubPullRequestActivity.actorId,
      body: githubPullRequestActivity.body,
      state: githubPullRequestActivity.state,
      occurredAt: githubPullRequestActivity.occurredAt,
    })
    .from(githubPullRequestActivity)
    .where(
      and(
        eq(githubPullRequestActivity.pullRequestId, pull.id),
        inArray(githubPullRequestActivity.type, ['review', 'checks']),
      ),
    )
    .orderBy(asc(githubPullRequestActivity.occurredAt));
  const reviewDecision = historyReviewDecision(persistedHistory, pull.reviewDecision);
  let state = pull.state;
  if (!(pull.merged || pull.state === 'closed' || pull.draft)) {
    state =
      reviewDecision === 'approved' || reviewDecision === 'changes_requested'
        ? reviewDecision
        : 'open';
  }
  await database
    .update(githubPullRequest)
    .set({
      state,
      reviewDecision,
      checkStatus: rolledUpCheckStatus(persistedHistory) ?? pull.checkStatus,
      historySyncedAt: now,
      historyRefreshClaimedAt: null,
      syncId: nextSyncId,
      updatedAt: now,
    })
    .where(eq(githubPullRequest.id, pull.id));
  return input.entries.length;
}

async function issueIdentifiers(
  database: GithubDatabase,
  repo: RepositorySync,
  event: NormalizedGithubEvent,
): Promise<string[]> {
  if (event.comment !== null && event.pullRequest !== null) {
    return await identifiersFromGitLinks(
      database,
      repo.organizationId,
      event.repository.externalId,
      event.repository.fullName,
      [event.pullRequest.number],
    );
  }
  if (event.pullRequest !== null) {
    return unique([
      ...extractIssueIdentifiers(`${event.pullRequest.headRef} ${event.pullRequest.title}`),
      ...declaredIssueIdentifiers(event.pullRequest.body),
    ]);
  }
  if (event.checks === null) return [];
  const linked = await identifiersFromGitLinks(
    database,
    repo.organizationId,
    event.repository.externalId,
    event.repository.fullName,
    event.checks.prNumbers,
  );
  return unique([...extractIssueIdentifiers(event.checks.headBranch), ...linked]);
}

interface IssueOutcome {
  readonly actions: SyncAction[];
  readonly notificationEvents: NotificationEvent[];
  readonly gitLink: GitLinkRow | null;
}

interface ApplyToIssueContext {
  readonly repo: RepositorySync;
  readonly event: NormalizedGithubEvent;
  readonly linked: LinkedIssue;
  readonly actor: Actor;
  readonly audienceUserIds: readonly string[];
  readonly mirroredPullRequest: GithubPullRequestRow | null;
  readonly stalePullRequestEvent: boolean;
  readonly now: Date;
}

function notificationOnlyIssueOutcome(context: ApplyToIssueContext): IssueOutcome | null {
  const { event, linked, actor, repo, audienceUserIds } = context;
  if (event.comment !== null && event.pullRequest !== null) {
    const notificationEvents =
      event.action === 'created'
        ? [
            commentNotification({
              linked,
              pullRequest: event.pullRequest,
              comment: event.comment,
              actor,
              repo,
              audienceUserIds,
            }),
          ]
        : [];
    return { actions: [], notificationEvents, gitLink: null };
  }
  if (event.pullRequest !== null) return null;
  return { actions: [], notificationEvents: [], gitLink: null };
}

async function applyToIssue(
  database: GithubDatabase,
  context: ApplyToIssueContext,
): Promise<IssueOutcome> {
  const {
    event,
    linked,
    actor,
    audienceUserIds,
    mirroredPullRequest,
    stalePullRequestEvent,
    now,
    repo,
  } = context;
  const notificationOnly = notificationOnlyIssueOutcome(context);
  if (notificationOnly !== null) return notificationOnly;

  const actions: SyncAction[] = [];
  const notificationEvents: NotificationEvent[] = [];
  const pr = event.pullRequest;
  if (pr === null) return { actions, notificationEvents, gitLink: null };
  const externalId = `pr:${event.repository.externalId}#${pr.number}:${linked.id}`;
  const [existing] = await database
    .select()
    .from(gitLink)
    .where(
      or(
        eq(gitLink.externalId, externalId),
        and(
          eq(gitLink.organizationId, repo.organizationId),
          eq(gitLink.issueId, linked.id),
          eq(gitLink.provider, 'github'),
          eq(gitLink.kind, 'pull_request'),
          eq(gitLink.repository, event.repository.fullName),
          eq(gitLink.number, pr.number),
        ),
      ),
    )
    .limit(1);

  const state =
    (mirroredPullRequest?.state as PullRequestState | undefined) ??
    resolveLinkState(pr, event, existing?.state as PullRequestState | undefined);

  const linkValues = {
    pullRequestId: mirroredPullRequest?.id ?? null,
    externalId,
    number: pr.number,
    repository: repo.repositoryName,
    branch: mirroredPullRequest?.headRef ?? pr.headRef,
    title: mirroredPullRequest?.title ?? pr.title,
    url: mirroredPullRequest?.url ?? pr.url,
    state,
    draft: mirroredPullRequest?.draft ?? pr.draft,
    merged: mirroredPullRequest?.merged ?? pr.merged,
    syncId: nextSyncId,
    updatedAt: now,
  };
  const [linkRow] =
    existing === undefined
      ? await database
          .insert(gitLink)
          .values({
            id: randomUUIDv7(),
            organizationId: repo.organizationId,
            issueId: linked.id,
            provider: 'github',
            kind: 'pull_request',
            ...linkValues,
          })
          .onConflictDoUpdate({
            target: [gitLink.provider, gitLink.externalId],
            set: linkValues,
          })
          .returning({ ...getTableColumns(gitLink), inserted: sql<boolean>`xmax = 0` })
      : await database
          .update(gitLink)
          .set(linkValues)
          .where(eq(gitLink.id, existing.id))
          .returning({ ...getTableColumns(gitLink), inserted: sql<boolean>`false` });
  if (linkRow === undefined) return { actions, notificationEvents, gitLink: null };
  const { inserted, ...link } = linkRow;

  actions.push(
    buildAction({
      syncId: link.syncId,
      organizationId: repo.organizationId,
      scopes: linkScopes(linked, audienceUserIds),
      action: inserted ? 'insert' : 'update',
      model: 'git_link',
      modelId: link.id,
      data: serializeGitLink(link),
      actor,
      at: now,
    }),
  );

  const transition = stalePullRequestEvent
    ? null
    : await transitionIssue(database, { linked, state, actor, now });
  if (transition !== null) actions.push(transition);

  const notification = stalePullRequestEvent
    ? null
    : pullRequestNotification({ linked, event, state, actor, audienceUserIds, repo });
  if (notification !== null) {
    notificationEvents.push({ ...notification, organizationId: repo.organizationId });
  }

  return { actions, notificationEvents, gitLink: link };
}

function resolveLinkState(
  pr: NonNullable<NormalizedGithubEvent['pullRequest']>,
  event: NormalizedGithubEvent,
  previous: PullRequestState | undefined,
): PullRequestState {
  const decision = event.review?.decision ?? null;
  if (decision === 'approved' || decision === 'changes_requested') {
    return pullRequestState({
      draft: pr.draft,
      merged: pr.merged,
      closed: pr.closed,
      review: decision,
    });
  }
  const base = pullRequestState({ draft: pr.draft, merged: pr.merged, closed: pr.closed });
  if (event.review !== null && base === 'open' && previous !== undefined) return previous;
  return base;
}

async function transitionIssue(
  database: GithubDatabase,
  context: {
    readonly linked: LinkedIssue;
    readonly state: PullRequestState;
    readonly actor: Actor;
    readonly now: Date;
  },
): Promise<SyncAction | null> {
  const { linked, state, actor, now } = context;
  const target = targetCategoryFor(state);
  if (target === null || !canAdvance(linked.category, target)) return null;

  const [targetState] = await database
    .select({ id: workflowState.id })
    .from(workflowState)
    .where(and(eq(workflowState.teamId, linked.teamId), eq(workflowState.category, target)))
    .orderBy(asc(workflowState.position))
    .limit(1);
  if (targetState === undefined || targetState.id === linked.stateId) return null;

  const [row] = await database
    .update(issue)
    .set({
      stateId: targetState.id,
      syncId: nextSyncId,
      updatedAt: now,
      ...stateTimestamps(target, linked.startedAt, now),
    })
    .where(eq(issue.id, linked.id))
    .returning();
  if (row === undefined) return null;

  const [labels, reviewers] = await Promise.all([
    database
      .select({ labelId: issueLabel.labelId })
      .from(issueLabel)
      .where(eq(issueLabel.issueId, row.id)),
    database
      .select({ userId: issueReviewer.userId })
      .from(issueReviewer)
      .where(eq(issueReviewer.issueId, row.id)),
  ]);

  return buildAction({
    syncId: row.syncId,
    organizationId: row.organizationId,
    scopes: [scopes.issue(row.id), scopes.team(row.teamId)],
    action: 'update',
    model: 'issue',
    modelId: row.id,
    data: {
      ...row,
      labelIds: labels.map((entry) => entry.labelId),
      reviewerIds: reviewers.map((entry) => entry.userId).sort(),
    },
    actor,
    at: now,
  });
}

function stateTimestamps(category: StateCategory, startedAt: Date | null, now: Date) {
  if (category === 'completed') {
    return { completedAt: now, canceledAt: null, stateEnteredAt: now, startedAt: startedAt ?? now };
  }
  if (category === 'canceled') {
    return { canceledAt: now, completedAt: null, stateEnteredAt: now };
  }
  return { startedAt: startedAt ?? now, completedAt: null, canceledAt: null, stateEnteredAt: now };
}

function pullRequestNotification(context: {
  readonly linked: LinkedIssue;
  readonly event: NormalizedGithubEvent;
  readonly state: PullRequestState;
  readonly actor: Actor;
  readonly audienceUserIds: readonly string[];
  readonly repo: RepositorySync;
}): Omit<NotificationEvent, 'organizationId'> | null {
  const { linked, event, state, actor, audienceUserIds, repo } = context;
  const pr = event.pullRequest;
  if (pr === null) return null;
  const base = {
    actor,
    entityType: 'issue',
    entityId: linked.id,
    url: `/issue/${linked.identifier}`,
    externalUrl: event.review?.url ?? pr.url,
    body: `${repo.repositoryName}#${pr.number}`,
  };

  if (event.action === 'review_requested') {
    return {
      ...base,
      type: 'pr_review_requested',
      reason: 'review_requested',
      userIds: [...audienceUserIds],
      title: `Review requested on ${pr.title}`,
    };
  }

  if (
    event.review !== null &&
    event.action === 'submitted' &&
    event.review.decision !== 'dismissed'
  ) {
    const type = notificationTypeForReview(event.review.decision);
    return {
      ...base,
      type,
      reason: type === 'pr_approved' ? 'review_approved' : 'subscribed',
      userIds: [...audienceUserIds],
      title: type === 'pr_approved' ? `${pr.title} was approved` : `New review on ${pr.title}`,
    };
  }

  const lifecycle = notificationTypeForState(state);
  if (lifecycle !== null) {
    return {
      ...base,
      type: lifecycle,
      reason: lifecycle === 'pr_merged' ? 'pull_request_merged' : 'subscribed',
      userIds: [...audienceUserIds],
      title: lifecycle === 'pr_merged' ? `${pr.title} was merged` : `${pr.title} was closed`,
    };
  }

  return null;
}

async function unlinkedPullRequestNotifications(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly pullRequests: readonly GithubPullRequestRow[];
  },
): Promise<NotificationEvent[]> {
  const { repo, event, pullRequests } = context;
  if (pullRequests.length === 0) return [];
  const actor = await resolveActor(database, event);
  const reviewerUserId =
    event.requestedReviewer === null
      ? null
      : await githubAccountUser(database, event.requestedReviewer.id);
  const candidatesByPull = new Map(
    await Promise.all(
      pullRequests.map(
        async (pull) =>
          [
            pull.id,
            await unlinkedPullRequestAudience(database, event, pull, reviewerUserId),
          ] as const,
      ),
    ),
  );
  const authorizedUserIds = new Set(
    await authorizedWorkspaceUsers(
      database,
      repo.organizationId,
      unique([...candidatesByPull.values()].filter((userId): userId is string => userId !== null)),
    ),
  );

  return pullRequests.flatMap((pull) => {
    const candidate = candidatesByPull.get(pull.id) ?? null;
    const userIds = candidate !== null && authorizedUserIds.has(candidate) ? [candidate] : [];
    if (userIds.length === 0) return [];
    const notification = unlinkedPullRequestNotification({ repo, event, pull, actor, userIds });
    return notification === null ? [] : [notification];
  });
}

async function unlinkedPullRequestAudience(
  database: GithubDatabase,
  event: NormalizedGithubEvent,
  pull: GithubPullRequestRow,
  reviewerUserId: string | null,
): Promise<string | null> {
  if (event.action === 'review_requested') return reviewerUserId;
  if (pull.authorId.length === 0) return null;
  return await githubAccountUser(database, pull.authorId);
}

function unlinkedPullRequestNotification(context: {
  readonly repo: RepositorySync;
  readonly event: NormalizedGithubEvent;
  readonly pull: GithubPullRequestRow;
  readonly actor: Actor;
  readonly userIds: readonly string[];
}): NotificationEvent | null {
  const { repo, event, pull, actor, userIds } = context;
  const base = {
    organizationId: repo.organizationId,
    actor,
    entityType: 'github_pull_request',
    entityId: pull.id,
    userIds: [...userIds],
    url: `/pulls/${pull.id}`,
  };

  if (event.comment !== null) {
    return {
      ...base,
      type: 'pr_comment',
      reason: 'commented',
      title:
        event.comment.kind === 'inline'
          ? `New inline comment on ${pull.title}`
          : `New comment on ${pull.title}`,
      body: event.comment.body,
      externalUrl: event.comment.url,
    };
  }
  if (event.action === 'review_requested') {
    return {
      ...base,
      type: 'pr_review_requested',
      reason: 'review_requested',
      title: `Review requested on ${pull.title}`,
      body: `${repo.repositoryName}#${pull.number}`,
      externalUrl: pull.url,
    };
  }
  if (
    event.review !== null &&
    event.action === 'submitted' &&
    event.review.decision !== 'dismissed'
  ) {
    const type = notificationTypeForReview(event.review.decision);
    return {
      ...base,
      type,
      reason: type === 'pr_approved' ? 'review_approved' : 'subscribed',
      title: type === 'pr_approved' ? `${pull.title} was approved` : `New review on ${pull.title}`,
      body: event.activity.body,
      externalUrl: event.review.url,
    };
  }
  const lifecycle = notificationTypeForState(pull.state as PullRequestState);
  if (lifecycle === null) return null;
  return {
    ...base,
    type: lifecycle,
    reason: lifecycle === 'pr_merged' ? 'pull_request_merged' : 'subscribed',
    title: lifecycle === 'pr_merged' ? `${pull.title} was merged` : `${pull.title} was closed`,
    body: `${repo.repositoryName}#${pull.number}`,
    externalUrl: pull.url,
  };
}

function commentNotification(context: {
  readonly linked: LinkedIssue;
  readonly pullRequest: NonNullable<NormalizedGithubEvent['pullRequest']>;
  readonly comment: NonNullable<NormalizedGithubEvent['comment']>;
  readonly actor: Actor;
  readonly repo: RepositorySync;
  readonly audienceUserIds: readonly string[];
}): NotificationEvent {
  const { linked, pullRequest, comment, actor, repo, audienceUserIds } = context;
  return {
    organizationId: repo.organizationId,
    type: 'pr_comment',
    reason: 'commented',
    actor,
    entityType: 'issue',
    entityId: linked.id,
    userIds: [...audienceUserIds],
    title:
      comment.kind === 'inline'
        ? `New inline comment on ${pullRequest.title}`
        : `New comment on ${pullRequest.title}`,
    body: comment.body,
    url: `/issue/${linked.identifier}`,
    externalUrl: comment.url,
  };
}

function linkScopes(linked: LinkedIssue, audienceUserIds: readonly string[]): string[] {
  return unique([
    scopes.issue(linked.id),
    scopes.team(linked.teamId),
    ...audienceUserIds.map(scopes.user),
  ]);
}

function audienceIds(linked: LinkedIssue, extra: string | null): string[] {
  const ids = [linked.creatorId];
  if (linked.assigneeId !== null) ids.push(linked.assigneeId);
  if (extra !== null) ids.push(extra);
  return unique(ids.concat(linked.subscriberIds));
}

async function authorizedAudiences(
  database: GithubDatabase,
  organizationId: string,
  issues: readonly LinkedIssue[],
  extra: string | null,
): Promise<Map<string, string[]>> {
  const candidateIds = unique(issues.flatMap((linked) => audienceIds(linked, extra))).sort();
  if (candidateIds.length === 0) return new Map();
  const memberships = await database
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), inArray(member.userId, candidateIds)))
    .orderBy(asc(member.userId))
    .for('update');
  const roles = new Map(memberships.map((entry) => [entry.userId, entry.role]));
  const teamIds = unique(issues.map((linked) => linked.teamId)).sort();
  const teamMemberships = await database
    .select({ userId: teamMember.userId, teamId: teamMember.teamId })
    .from(teamMember)
    .where(and(inArray(teamMember.userId, candidateIds), inArray(teamMember.teamId, teamIds)))
    .orderBy(asc(teamMember.teamId), asc(teamMember.userId))
    .for('update');
  const teamsByUser = new Map<string, Set<string>>();
  for (const entry of teamMemberships) {
    const teams = teamsByUser.get(entry.userId) ?? new Set<string>();
    teams.add(entry.teamId);
    teamsByUser.set(entry.userId, teams);
  }
  return new Map(
    issues.map((linked) => [
      linked.id,
      audienceIds(linked, extra).filter((userId) => {
        const role = roles.get(userId);
        if (role === undefined) return false;
        const principal: Principal = {
          userId,
          organizationId,
          role: policyRole(role),
          teamIds: [...(teamsByUser.get(userId) ?? [])],
        };
        return isInTeam(principal, { id: linked.teamId, organizationId });
      }),
    ]),
  );
}

async function authorizedWorkspaceUsers(
  database: GithubDatabase,
  organizationId: string,
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await database
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), inArray(member.userId, [...userIds])))
    .orderBy(asc(member.userId))
    .for('update');
  return unique(
    rows.flatMap((row) => {
      const principal: Principal = {
        userId: row.userId,
        organizationId,
        role: policyRole(row.role),
        teamIds: [],
      };
      return isInOrganization(principal, organizationId) ? [row.userId] : [];
    }),
  );
}

async function identifiersFromGitLinks(
  database: GithubDatabase,
  organizationId: string,
  repositoryId: string,
  repository: string,
  prNumbers: readonly number[],
): Promise<string[]> {
  if (prNumbers.length === 0) return [];
  const pulls = await database
    .select({ id: githubPullRequest.id })
    .from(githubPullRequest)
    .where(
      and(
        eq(githubPullRequest.organizationId, organizationId),
        eq(githubPullRequest.repositoryId, repositoryId),
        inArray(githubPullRequest.number, [...prNumbers]),
      ),
    );
  const identity =
    pulls.length === 0
      ? eq(gitLink.repository, repository)
      : or(
          inArray(
            gitLink.pullRequestId,
            pulls.map((pull) => pull.id),
          ),
          eq(gitLink.repository, repository),
        );
  const rows = await database
    .select({ identifier: issue.identifier })
    .from(gitLink)
    .innerJoin(issue, eq(issue.id, gitLink.issueId))
    .where(
      and(
        eq(gitLink.organizationId, organizationId),
        eq(gitLink.provider, 'github'),
        identity,
        inArray(gitLink.number, [...prNumbers]),
      ),
    )
    .orderBy(asc(gitLink.id))
    .for('update', { of: gitLink });
  return rows.map((row) => row.identifier);
}

async function loadLinkedIssues(
  database: GithubDatabase,
  organizationId: string,
  identifiers: readonly string[],
): Promise<LinkedIssue[]> {
  const rows = await database
    .select({
      id: issue.id,
      teamId: issue.teamId,
      identifier: issue.identifier,
      stateId: issue.stateId,
      category: workflowState.category,
      assigneeId: issue.assigneeId,
      creatorId: issue.creatorId,
      startedAt: issue.startedAt,
    })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(
      and(eq(issue.organizationId, organizationId), inArray(issue.identifier, [...identifiers])),
    )
    .orderBy(asc(issue.id))
    .for('update', { of: issue });
  if (rows.length === 0) return [];

  const subscriptions = await database
    .select({ issueId: issueSubscription.issueId, userId: issueSubscription.userId })
    .from(issueSubscription)
    .where(
      inArray(
        issueSubscription.issueId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(issueSubscription.issueId), asc(issueSubscription.userId))
    .for('update');
  const byIssue = new Map<string, string[]>();
  for (const sub of subscriptions) {
    byIssue.set(sub.issueId, [...(byIssue.get(sub.issueId) ?? []), sub.userId]);
  }

  return rows.map((row) => ({
    id: row.id,
    teamId: row.teamId,
    identifier: row.identifier,
    stateId: row.stateId,
    category: row.category as StateCategory,
    assigneeId: row.assigneeId,
    creatorId: row.creatorId,
    startedAt: row.startedAt,
    subscriberIds: byIssue.get(row.id) ?? [],
  }));
}

async function resolveActor(
  database: GithubDatabase,
  event: NormalizedGithubEvent,
): Promise<Actor> {
  const orbitUserId = await githubAccountUser(database, event.sender.id);
  if (orbitUserId !== null) {
    const [found] = await database
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, orbitUserId))
      .limit(1);
    return { type: 'user', id: orbitUserId, name: found?.name ?? event.sender.login };
  }
  return { type: 'integration', id: 'github', name: event.sender.login };
}

async function githubAccountUser(
  database: GithubDatabase,
  githubId: number | string,
): Promise<string | null> {
  const [row] = await database
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, 'github'), eq(account.accountId, String(githubId))))
    .limit(1);
  return row?.userId ?? null;
}

function serializeGitLink(row: GitLinkRow): Record<string, unknown> {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function buildAction(input: {
  readonly syncId: number;
  readonly organizationId: string;
  readonly scopes: readonly string[];
  readonly action: SyncAction['action'];
  readonly model: SyncAction['model'];
  readonly modelId: string;
  readonly data: Record<string, unknown>;
  readonly actor: Actor;
  readonly at: Date;
}): SyncAction {
  return {
    syncId: input.syncId,
    organizationId: input.organizationId,
    scopes: [...new Set(input.scopes)],
    action: input.action,
    model: input.model,
    modelId: input.modelId,
    data: input.data,
    actor: input.actor,
    at: input.at.toISOString(),
  };
}
