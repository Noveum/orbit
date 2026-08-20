import type { Database, Transaction } from '@orbit/db';
import {
  account,
  githubPullRequest,
  githubPullRequestActivity,
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
    readonly now?: Date;
  },
): Promise<GithubApplyResult> {
  const event = parseGithubEvent(input.eventName, input.body);
  if (event === null) return { ...EMPTY, ignoredReason: 'unsupported_event' };

  return await applyNormalizedGithubEvent(database, {
    event,
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export async function applyNormalizedGithubEvent(
  database: GithubDatabase,
  input: {
    readonly event: NormalizedGithubEvent;
    readonly organizationId?: string | null;
    readonly now?: Date;
  },
): Promise<GithubApplyResult> {
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
    .limit(1);
  if (repo === undefined) return { ...EMPTY, ignoredReason: 'repository_not_connected' };
  if (!repo.enabled) return { ...EMPTY, ignoredReason: 'repository_disabled' };

  const now = input.now ?? new Date();
  const pullRequests = await persistGithubMirror(database, { repo, event, now });
  const mirroredPullRequest = pullRequests[0] ?? null;
  const stalePullRequestEvent =
    mirroredPullRequest !== null && pullRequestEventIsStale(event, mirroredPullRequest, now);
  const identifiers = await issueIdentifiers(database, repo, event);
  if (identifiers.length === 0) {
    return await resultWithoutLinkedIssues(database, {
      repo,
      event,
      pullRequests,
      stalePullRequestEvent,
      emptyReason: 'no_issue_identifier',
    });
  }

  const issues = await loadLinkedIssues(database, repo.organizationId, identifiers);
  if (issues.length === 0) {
    return await resultWithoutLinkedIssues(database, {
      repo,
      event,
      pullRequests,
      stalePullRequestEvent,
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

  return {
    handled: true,
    ignoredReason: null,
    organizationId: repo.organizationId,
    actions,
    notificationEvents,
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
    readonly stalePullRequestEvent: boolean;
    readonly emptyReason: Extract<GithubIgnoredReason, 'no_issue_identifier' | 'no_matching_issue'>;
  },
): Promise<GithubApplyResult> {
  const { repo, event, pullRequests, stalePullRequestEvent, emptyReason } = context;
  const notificationEvents = stalePullRequestEvent
    ? []
    : await unlinkedPullRequestNotifications(database, { repo, event, pullRequests });
  return {
    ...EMPTY,
    handled: true,
    ignoredReason: pullRequests.length === 0 ? emptyReason : null,
    organizationId: repo.organizationId,
    notificationEvents,
    pullRequests,
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

function checkStatus(event: NormalizedGithubEvent): string {
  if (event.checks === null) return 'unknown';
  if (event.checks.failed) return 'failure';
  const state = (event.checks.conclusion || event.checks.status).toLowerCase();
  if (['success', 'neutral', 'skipped'].includes(state)) return 'success';
  if (['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(state))
    return 'pending';
  return 'unknown';
}

function checkPullRequestFilter(checks: NonNullable<NormalizedGithubEvent['checks']>) {
  if (checks.prNumbers.length > 0) return inArray(githubPullRequest.number, checks.prNumbers);
  if (checks.headSha.length > 0) return eq(githubPullRequest.headSha, checks.headSha);
  if (checks.headBranch.length > 0) return eq(githubPullRequest.headRef, checks.headBranch);
  return sql<boolean>`false`;
}

async function persistGithubMirror(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly now: Date;
  },
): Promise<GithubPullRequestRow[]> {
  const { repo, event, now } = context;
  if (event.pullRequest !== null) {
    const row = await upsertMirroredPullRequest(database, context);
    if (row === null) return [];
    await upsertPullRequestActivity(database, { row, event, now });
    return [row];
  }
  if (event.checks === null) return [];

  const numberFilter = checkPullRequestFilter(event.checks);
  const rows = await database
    .select()
    .from(githubPullRequest)
    .where(and(eq(githubPullRequest.repositorySyncId, repo.id), numberFilter));
  const updatedRows: GithubPullRequestRow[] = [];
  for (const row of rows) {
    await upsertPullRequestActivity(database, { row, event, now });
    const checkActivities = await database
      .select({
        externalId: githubPullRequestActivity.externalId,
        type: githubPullRequestActivity.type,
        body: githubPullRequestActivity.body,
        state: githubPullRequestActivity.state,
        occurredAt: githubPullRequestActivity.occurredAt,
      })
      .from(githubPullRequestActivity)
      .where(
        and(
          eq(githubPullRequestActivity.pullRequestId, row.id),
          eq(githubPullRequestActivity.type, 'checks'),
        ),
      );
    const [updated] = await database
      .update(githubPullRequest)
      .set({
        checkStatus: rolledUpCheckStatus(checkActivities) ?? checkStatus(event),
        repositoryName: repo.repositoryName,
        syncId: nextSyncId,
        updatedAt: now,
      })
      .where(eq(githubPullRequest.id, row.id))
      .returning();
    if (updated !== undefined) {
      updatedRows.push(updated);
    }
  }
  return updatedRows;
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

async function upsertMirroredPullRequest(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly now: Date;
  },
): Promise<GithubPullRequestRow | null> {
  const { repo, event, now } = context;
  const pr = event.pullRequest;
  if (pr === null) return null;
  const [existing] = await database
    .select()
    .from(githubPullRequest)
    .where(
      and(eq(githubPullRequest.repositorySyncId, repo.id), eq(githubPullRequest.number, pr.number)),
    )
    .limit(1);
  const occurredAt = eventDate(event.activity.occurredAt ?? pr.updatedAt, now);
  const stale = existing !== undefined && occurredAt.getTime() < existing.lastEventAt.getTime();
  const completeSnapshot =
    pr.externalId.length > 0 || pr.nodeId.length > 0 || pr.headRef.length > 0;
  const retainSnapshot = stale || !completeSnapshot;
  const reviewDecision = mirroredReviewDecision(event, existing, stale);
  const state = mirroredState(retainSnapshot, existing, pr, reviewDecision);
  let authorLogin = existing?.authorLogin ?? '';
  let authorId = existing?.authorId ?? '';
  if (pr.author !== null) {
    authorLogin = pr.author.login;
    authorId = String(pr.author.id);
  }
  const values = {
    repositoryId: event.repository.externalId,
    repositoryName: repo.repositoryName,
    number: pr.number,
    nodeId: latestText(retainSnapshot, existing?.nodeId, pr.nodeId),
    title: latestText(retainSnapshot, existing?.title, pr.title),
    body: retainedValue(retainSnapshot, existing?.body, pr.body),
    url: latestText(retainSnapshot, existing?.url, pr.url),
    headRef: retainedValue(retainSnapshot, existing?.headRef, pr.headRef),
    headSha: retainedValue(retainSnapshot, existing?.headSha, pr.headSha),
    baseRef: retainedValue(retainSnapshot, existing?.baseRef, pr.baseRef),
    state,
    draft: retainedValue(retainSnapshot, existing?.draft, pr.draft),
    merged: retainedValue(retainSnapshot, existing?.merged, pr.merged),
    authorLogin,
    authorId,
    reviewDecision,
    checkStatus: existing?.checkStatus ?? 'unknown',
    githubCreatedAt: githubDate(pr.createdAt, existing?.githubCreatedAt, now),
    githubUpdatedAt: githubDate(pr.updatedAt, existing?.githubUpdatedAt, now),
    lastEventAt: retainedValue(stale, existing?.lastEventAt, occurredAt),
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
      setWhere: lte(githubPullRequest.lastEventAt, occurredAt),
    })
    .returning();
  if (row !== undefined) return row;
  const [current] = await database
    .select()
    .from(githubPullRequest)
    .where(
      and(eq(githubPullRequest.repositorySyncId, repo.id), eq(githubPullRequest.number, pr.number)),
    )
    .limit(1);
  return current ?? null;
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
  const notificationEvents =
    event.checks?.failed === true
      ? [checksNotification({ linked, event, actor, repo, audienceUserIds })]
      : [];
  return { actions: [], notificationEvents, gitLink: null };
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
  const candidates = unique(
    await Promise.all(
      pullRequests.map(async (pull) => {
        if (event.action === 'review_requested') return reviewerUserId;
        return pull.authorId.length === 0 ? null : await githubAccountUser(database, pull.authorId);
      }),
    ).then((ids) => ids.filter((id): id is string => id !== null)),
  );
  const userIds = await authorizedWorkspaceUsers(database, repo.organizationId, candidates);
  if (userIds.length === 0) return [];

  return pullRequests.flatMap((pull) => {
    const notification = unlinkedPullRequestNotification({ repo, event, pull, actor, userIds });
    return notification === null ? [] : [notification];
  });
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
  if (event.checks?.failed === true) {
    return {
      ...base,
      type: 'pr_checks_failed',
      reason: 'subscribed',
      title: `Checks failed on ${pull.title}`,
      body: `${repo.repositoryName}#${pull.number}`,
      externalUrl: event.activity.url.length === 0 ? pull.url : event.activity.url,
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

function checksNotification(context: {
  readonly linked: LinkedIssue;
  readonly event: NormalizedGithubEvent;
  readonly actor: Actor;
  readonly repo: RepositorySync;
  readonly audienceUserIds: readonly string[];
}): NotificationEvent {
  const { linked, event, actor, repo, audienceUserIds } = context;
  const branch = event.checks?.headBranch ?? linked.identifier;
  return {
    organizationId: repo.organizationId,
    type: 'pr_checks_failed',
    reason: 'subscribed',
    actor,
    entityType: 'issue',
    entityId: linked.id,
    userIds: [...audienceUserIds],
    title: `Checks failed on ${branch}`,
    body: repo.repositoryName,
    url: `/issue/${linked.identifier}`,
    externalUrl:
      event.checks?.prNumbers[0] === undefined
        ? null
        : `https://github.com/${repo.repositoryName}/pull/${event.checks.prNumbers[0]}`,
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
  const candidateIds = unique(issues.flatMap((linked) => audienceIds(linked, extra)));
  if (candidateIds.length === 0) return new Map();
  const memberships = await database
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), inArray(member.userId, candidateIds)));
  const roles = new Map(memberships.map((entry) => [entry.userId, entry.role]));
  const teamIds = unique(issues.map((linked) => linked.teamId));
  const teamMemberships = await database
    .select({ userId: teamMember.userId, teamId: teamMember.teamId })
    .from(teamMember)
    .where(and(inArray(teamMember.userId, candidateIds), inArray(teamMember.teamId, teamIds)));
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
    .where(and(eq(member.organizationId, organizationId), inArray(member.userId, [...userIds])));
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
    );
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
    );
  if (rows.length === 0) return [];

  const subscriptions = await database
    .select({ issueId: issueSubscription.issueId, userId: issueSubscription.userId })
    .from(issueSubscription)
    .where(
      inArray(
        issueSubscription.issueId,
        rows.map((row) => row.id),
      ),
    );
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
