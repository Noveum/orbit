import type { Database, Transaction } from '@orbit/db';
import {
  account,
  githubPullRequest,
  githubRepositorySync,
  gitLink,
  issue,
  issueSubscription,
  member,
  teamMember,
} from '@orbit/db/schema';
import { unique } from '@orbit/shared';
import { isInOrganization, isInTeam, type Principal, policyRole } from '@orbit/shared/policy';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { type NotificationEvent, notifyMany } from '../notifications/index.ts';
import type { GithubCheckFailureTransition } from './reconciliation.ts';

type GithubNotificationDatabase = Database | Transaction;

interface LinkedIssueAudience {
  readonly id: string;
  readonly teamId: string;
  readonly creatorId: string;
  readonly assigneeId: string | null;
}

interface GithubFailureNotificationOptions {
  readonly now?: Date;
  readonly slackEnabled?: boolean;
}

async function mappedGithubUser(
  database: GithubNotificationDatabase,
  organizationId: string,
  githubUserId: string,
): Promise<string | null> {
  if (githubUserId.length === 0) return null;
  const [mapped] = await database
    .select({ userId: account.userId })
    .from(account)
    .innerJoin(
      member,
      and(eq(member.userId, account.userId), eq(member.organizationId, organizationId)),
    )
    .where(and(eq(account.providerId, 'github'), eq(account.accountId, githubUserId)))
    .limit(1);
  return mapped?.userId ?? null;
}

async function linkedIssues(
  database: GithubNotificationDatabase,
  transition: GithubCheckFailureTransition,
): Promise<LinkedIssueAudience[]> {
  return await database
    .select({
      id: issue.id,
      teamId: issue.teamId,
      creatorId: issue.creatorId,
      assigneeId: issue.assigneeId,
    })
    .from(gitLink)
    .innerJoin(
      issue,
      and(eq(issue.id, gitLink.issueId), eq(issue.organizationId, transition.organizationId)),
    )
    .where(
      and(
        eq(gitLink.organizationId, transition.organizationId),
        eq(gitLink.provider, 'github'),
        eq(gitLink.kind, 'pull_request'),
        eq(gitLink.pullRequestId, transition.pullRequestId),
      ),
    )
    .orderBy(asc(issue.id));
}

async function linkedIssueSubscribers(
  database: GithubNotificationDatabase,
  issueIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (issueIds.length === 0) return new Map();
  const rows = await database
    .select({ issueId: issueSubscription.issueId, userId: issueSubscription.userId })
    .from(issueSubscription)
    .where(inArray(issueSubscription.issueId, [...issueIds]))
    .orderBy(asc(issueSubscription.issueId), asc(issueSubscription.userId));
  const byIssue = new Map<string, string[]>();
  for (const row of rows) {
    byIssue.set(row.issueId, [...(byIssue.get(row.issueId) ?? []), row.userId]);
  }
  return byIssue;
}

function principalFor(
  userId: string,
  organizationId: string,
  roles: ReadonlyMap<string, string>,
  teamsByUser: ReadonlyMap<string, ReadonlySet<string>>,
): Principal | null {
  const role = roles.get(userId);
  if (role === undefined) return null;
  return {
    userId,
    organizationId,
    role: policyRole(role),
    teamIds: [...(teamsByUser.get(userId) ?? [])],
  };
}

function linkedIssueCandidateIds(
  linkedIssue: LinkedIssueAudience,
  subscriptions: ReadonlyMap<string, readonly string[]>,
): string[] {
  return unique([
    linkedIssue.creatorId,
    ...(linkedIssue.assigneeId === null ? [] : [linkedIssue.assigneeId]),
    ...(subscriptions.get(linkedIssue.id) ?? []),
  ]);
}

function authorizedAudienceIds(input: {
  readonly organizationId: string;
  readonly linked: readonly LinkedIssueAudience[];
  readonly authorUserId: string | null;
  readonly subscriptions: ReadonlyMap<string, readonly string[]>;
  readonly roles: ReadonlyMap<string, string>;
  readonly teamsByUser: ReadonlyMap<string, ReadonlySet<string>>;
}): string[] {
  const authorized = new Set<string>();
  if (input.authorUserId !== null) {
    const principal = principalFor(
      input.authorUserId,
      input.organizationId,
      input.roles,
      input.teamsByUser,
    );
    if (principal !== null && isInOrganization(principal, input.organizationId)) {
      authorized.add(input.authorUserId);
    }
  }
  for (const linkedIssue of input.linked) {
    for (const userId of linkedIssueCandidateIds(linkedIssue, input.subscriptions)) {
      const principal = principalFor(userId, input.organizationId, input.roles, input.teamsByUser);
      if (
        principal !== null &&
        isInTeam(principal, { id: linkedIssue.teamId, organizationId: input.organizationId })
      ) {
        authorized.add(userId);
      }
    }
  }
  return [...authorized].sort();
}

async function authorizedFailureAudience(
  database: GithubNotificationDatabase,
  organizationId: string,
  linked: readonly LinkedIssueAudience[],
  authorUserId: string | null,
): Promise<string[]> {
  const subscriptions = await linkedIssueSubscribers(
    database,
    linked.map((entry) => entry.id),
  );
  const candidateIds = unique([
    ...(authorUserId === null ? [] : [authorUserId]),
    ...linked.flatMap((entry) => linkedIssueCandidateIds(entry, subscriptions)),
  ]).sort();
  if (candidateIds.length === 0) return [];
  const memberships = await database
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), inArray(member.userId, candidateIds)))
    .orderBy(asc(member.userId));
  const roles = new Map(memberships.map((entry) => [entry.userId, entry.role]));
  const teamIds = unique(linked.map((entry) => entry.teamId)).sort();
  const teamMemberships =
    teamIds.length === 0
      ? []
      : await database
          .select({ userId: teamMember.userId, teamId: teamMember.teamId })
          .from(teamMember)
          .where(and(inArray(teamMember.userId, candidateIds), inArray(teamMember.teamId, teamIds)))
          .orderBy(asc(teamMember.teamId), asc(teamMember.userId));
  const teamsByUser = new Map<string, Set<string>>();
  for (const entry of teamMemberships) {
    const teams = teamsByUser.get(entry.userId) ?? new Set<string>();
    teams.add(entry.teamId);
    teamsByUser.set(entry.userId, teams);
  }
  return authorizedAudienceIds({
    organizationId,
    linked,
    authorUserId,
    subscriptions,
    roles,
    teamsByUser,
  });
}

export async function githubCheckFailureTransitionEvents(
  database: GithubNotificationDatabase,
  transitions: readonly GithubCheckFailureTransition[],
  now = new Date(),
): Promise<NotificationEvent[]> {
  const events: NotificationEvent[] = [];
  for (const transition of transitions) {
    const [pull] = await database
      .select()
      .from(githubPullRequest)
      .where(
        and(
          eq(githubPullRequest.organizationId, transition.organizationId),
          eq(githubPullRequest.repositorySyncId, transition.repositorySyncId),
          eq(githubPullRequest.id, transition.pullRequestId),
          eq(githubPullRequest.headSha, transition.headSha),
          eq(githubPullRequest.headEpoch, transition.headEpoch),
        ),
      )
      .limit(1);
    if (pull === undefined) continue;
    const [repository] = await database
      .select()
      .from(githubRepositorySync)
      .where(
        and(
          eq(githubRepositorySync.organizationId, transition.organizationId),
          eq(githubRepositorySync.id, transition.repositorySyncId),
        ),
      )
      .limit(1);
    if (repository === undefined) continue;
    const linked = await linkedIssues(database, transition);
    const authorUserId = await mappedGithubUser(database, transition.organizationId, pull.authorId);
    const userIds = await authorizedFailureAudience(
      database,
      transition.organizationId,
      linked,
      authorUserId,
    );
    let teamIds = linked.map((entry) => entry.teamId);
    if (linked.length === 0 && repository.teamId !== null) teamIds = [repository.teamId];
    events.push({
      organizationId: transition.organizationId,
      type: 'pr_checks_failed' as const,
      reason: 'subscribed' as const,
      actor: { type: 'integration' as const, id: 'github', name: 'GitHub' },
      entityType: 'github_pull_request',
      entityId: pull.id,
      userIds,
      title: `Checks failed on ${pull.title}`,
      body: `${repository.repositoryName}#${pull.number}`,
      url: `/pulls/${pull.id}`,
      externalUrl: pull.url,
      source: {
        sourceEventKey: `github-pr:${repository.repositoryId}:${pull.number}:${pull.headSha}:checks-failed`,
        subjectType: 'github_pull_request',
        subjectKey: `github-pr:${repository.repositoryId}:${pull.number}`,
        occurredAt: now,
        teamIds: unique(teamIds),
        payload: {
          action: 'reconciled',
          headSha: pull.headSha,
          repository: repository.repositoryName,
          pullRequestId: pull.id,
          pullRequestNumber: pull.number,
        },
      },
    });
  }
  return events;
}

export async function notifyGithubCheckFailureTransitions(
  database: GithubNotificationDatabase,
  transitions: readonly GithubCheckFailureTransition[],
  options: GithubFailureNotificationOptions = {},
) {
  const now = options.now ?? new Date();
  const events = await githubCheckFailureTransitionEvents(database, transitions, now);
  return await notifyMany(database, events, {
    now,
    ...(options.slackEnabled === undefined ? {} : { slackEnabled: options.slackEnabled }),
  });
}
