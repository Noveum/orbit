import type { Database, Transaction } from '@orbit/db';
import {
  account,
  githubRepositorySync,
  gitLink,
  issue,
  issueSubscription,
  nextSyncId,
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
import { randomUUIDv7 } from 'bun';
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { NotificationEvent } from '../notifications/index.ts';
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
type RepositorySync = typeof githubRepositorySync.$inferSelect;

export interface GithubApplyResult {
  readonly handled: boolean;
  readonly organizationId: string | null;
  readonly actions: SyncAction[];
  readonly notificationEvents: NotificationEvent[];
  readonly teamIds: string[];
  readonly gitLinks: GitLinkRow[];
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
  organizationId: null,
  actions: [],
  notificationEvents: [],
  teamIds: [],
  gitLinks: [],
};

export async function applyGithubEvent(
  database: GithubDatabase,
  input: { readonly eventName: string; readonly body: unknown; readonly now?: Date },
): Promise<GithubApplyResult> {
  const event = parseGithubEvent(input.eventName, input.body);
  if (event === null) return EMPTY;

  const [repo] = await database
    .select()
    .from(githubRepositorySync)
    .where(eq(githubRepositorySync.repositoryId, event.repository.externalId))
    .limit(1);
  if (repo === undefined || !repo.enabled) return EMPTY;

  const now = input.now ?? new Date();
  const textIdentifiers =
    event.pullRequest === null
      ? extractIssueIdentifiers(event.checks?.headBranch ?? '')
      : extractIssueIdentifiers(`${event.pullRequest.headRef} ${event.pullRequest.title}`);
  const linkedIdentifiers =
    event.pullRequest === null && event.checks !== null
      ? await identifiersFromGitLinks(
          database,
          repo.organizationId,
          event.repository.fullName,
          event.checks.prNumbers,
        )
      : [];
  const identifiers = unique([...textIdentifiers, ...linkedIdentifiers]);
  if (identifiers.length === 0) {
    return { ...EMPTY, handled: true, organizationId: repo.organizationId };
  }

  const issues = await loadLinkedIssues(database, repo.organizationId, identifiers);
  if (issues.length === 0) {
    return { ...EMPTY, handled: true, organizationId: repo.organizationId };
  }

  const actor = await resolveActor(database, event);
  const reviewerUserId =
    event.requestedReviewer === null
      ? null
      : await githubAccountUser(database, event.requestedReviewer.id);

  const actions: SyncAction[] = [];
  const notificationEvents: NotificationEvent[] = [];
  const gitLinks: GitLinkRow[] = [];

  for (const linked of issues) {
    const outcome = await applyToIssue(database, {
      repo,
      event,
      linked,
      actor,
      reviewerUserId,
      now,
    });
    actions.push(...outcome.actions);
    notificationEvents.push(...outcome.notificationEvents);
    if (outcome.gitLink !== null) gitLinks.push(outcome.gitLink);
  }

  return {
    handled: true,
    organizationId: repo.organizationId,
    actions,
    notificationEvents,
    teamIds: unique(issues.map((entry) => entry.teamId)),
    gitLinks,
  };
}

interface IssueOutcome {
  readonly actions: SyncAction[];
  readonly notificationEvents: NotificationEvent[];
  readonly gitLink: GitLinkRow | null;
}

async function applyToIssue(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly event: NormalizedGithubEvent;
    readonly linked: LinkedIssue;
    readonly actor: Actor;
    readonly reviewerUserId: string | null;
    readonly now: Date;
  },
): Promise<IssueOutcome> {
  const { event, linked, actor, reviewerUserId, now, repo } = context;
  const actions: SyncAction[] = [];
  const notificationEvents: NotificationEvent[] = [];

  if (event.pullRequest === null) {
    if (event.checks?.failed === true) {
      notificationEvents.push(checksNotification({ linked, event, actor, repo }));
    }
    return { actions, notificationEvents, gitLink: null };
  }

  const pr = event.pullRequest;
  const externalId = `pr:${event.repository.fullName}#${pr.number}:${linked.id}`;
  const [existing] = await database
    .select()
    .from(gitLink)
    .where(eq(gitLink.externalId, externalId))
    .limit(1);

  const state = resolveLinkState(pr, event, existing?.state as PullRequestState | undefined);

  const [linkRow] = await database
    .insert(gitLink)
    .values({
      id: existing?.id ?? randomUUIDv7(),
      organizationId: repo.organizationId,
      issueId: linked.id,
      provider: 'github',
      kind: 'pull_request',
      externalId,
      number: pr.number,
      repository: event.repository.fullName,
      branch: pr.headRef,
      title: pr.title,
      url: pr.url,
      state,
      draft: pr.draft,
      merged: pr.merged,
      syncId: nextSyncId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [gitLink.provider, gitLink.externalId],
      set: {
        number: pr.number,
        repository: event.repository.fullName,
        branch: pr.headRef,
        title: pr.title,
        url: pr.url,
        state,
        draft: pr.draft,
        merged: pr.merged,
        syncId: nextSyncId,
        updatedAt: now,
      },
    })
    .returning({ ...getTableColumns(gitLink), inserted: sql<boolean>`xmax = 0` });
  if (linkRow === undefined) return { actions, notificationEvents, gitLink: null };
  const { inserted, ...link } = linkRow;

  actions.push(
    buildAction({
      syncId: link.syncId,
      organizationId: repo.organizationId,
      scopes: linkScopes(linked),
      action: inserted ? 'insert' : 'update',
      model: 'git_link',
      modelId: link.id,
      data: serializeGitLink(link),
      actor,
      at: now,
    }),
  );

  const transition = await transitionIssue(database, { linked, state, actor, now });
  if (transition !== null) actions.push(transition);

  const notification = pullRequestNotification({ linked, event, state, actor, reviewerUserId });
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

  return buildAction({
    syncId: row.syncId,
    organizationId: row.organizationId,
    scopes: [scopes.issue(row.id), scopes.team(row.teamId)],
    action: 'update',
    model: 'issue',
    modelId: row.id,
    data: row,
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
  readonly reviewerUserId: string | null;
}): Omit<NotificationEvent, 'organizationId'> | null {
  const { linked, event, state, actor, reviewerUserId } = context;
  const pr = event.pullRequest;
  if (pr === null) return null;
  const base = {
    actor,
    entityType: 'issue',
    entityId: linked.id,
    url: `/issue/${linked.identifier}`,
    scopes: [scopes.issue(linked.id)],
    body: `${event.repository.fullName}#${pr.number}`,
  };

  if (event.action === 'review_requested') {
    return {
      ...base,
      type: 'pr_review_requested',
      userIds: audienceIds(linked, reviewerUserId),
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
      userIds: audienceIds(linked, null),
      title: type === 'pr_approved' ? `${pr.title} was approved` : `New review on ${pr.title}`,
    };
  }

  const lifecycle = notificationTypeForState(state);
  if (lifecycle !== null) {
    return {
      ...base,
      type: lifecycle,
      userIds: audienceIds(linked, null),
      title: lifecycle === 'pr_merged' ? `${pr.title} was merged` : `${pr.title} was closed`,
    };
  }

  return null;
}

function checksNotification(context: {
  readonly linked: LinkedIssue;
  readonly event: NormalizedGithubEvent;
  readonly actor: Actor;
  readonly repo: RepositorySync;
}): NotificationEvent {
  const { linked, event, actor, repo } = context;
  const branch = event.checks?.headBranch ?? linked.identifier;
  return {
    organizationId: repo.organizationId,
    type: 'pr_checks_failed',
    actor,
    entityType: 'issue',
    entityId: linked.id,
    userIds: audienceIds(linked, null),
    title: `Checks failed on ${branch}`,
    body: event.repository.fullName,
    url: `/issue/${linked.identifier}`,
    scopes: [scopes.issue(linked.id)],
  };
}

function linkScopes(linked: LinkedIssue): string[] {
  const list = [scopes.issue(linked.id), scopes.team(linked.teamId), scopes.user(linked.creatorId)];
  if (linked.assigneeId !== null) list.push(scopes.user(linked.assigneeId));
  return list;
}

function audienceIds(linked: LinkedIssue, extra: string | null): string[] {
  const ids = [linked.creatorId];
  if (linked.assigneeId !== null) ids.push(linked.assigneeId);
  if (extra !== null) ids.push(extra);
  return unique(ids.concat(linked.subscriberIds));
}

async function identifiersFromGitLinks(
  database: GithubDatabase,
  organizationId: string,
  repository: string,
  prNumbers: readonly number[],
): Promise<string[]> {
  if (prNumbers.length === 0) return [];
  const rows = await database
    .select({ identifier: issue.identifier })
    .from(gitLink)
    .innerJoin(issue, eq(issue.id, gitLink.issueId))
    .where(
      and(
        eq(gitLink.organizationId, organizationId),
        eq(gitLink.provider, 'github'),
        eq(gitLink.repository, repository),
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
  githubId: number,
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
