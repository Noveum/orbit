import { and, count, db, desc, eq, inArray, or, schema } from '@orbit/db';
import { renderMarkdown } from '@orbit/services/markdown';
import { isInTeam, type Principal, policyRole } from '@orbit/shared/policy';

export interface PullRequestIssueContext {
  readonly identifier: string;
  readonly title: string;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  } | null;
}

export interface PullRequestRow {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly repository: string;
  readonly number: number | null;
  readonly branch: string | null;
  readonly state: string;
  readonly draft: boolean;
  readonly merged: boolean;
  readonly authorLogin: string;
  readonly reviewDecision: string | null;
  readonly checkStatus: string;
  readonly activityCount: number;
  readonly linkedIssues: readonly PullRequestIssueContext[];
  readonly updatedAt: string;
}

export interface PullRequestPage {
  readonly pulls: PullRequestRow[];
  readonly hasMore: boolean;
  readonly total: number;
}

export const PULL_REQUEST_PAGE_SIZE = 100;
export const PULL_REQUEST_ACTIVITY_LIMIT = 200;

function pullRequestLinkKeys(
  pullRequestId: string | null,
  repository: string,
  number: number | null,
): string[] {
  const keys = pullRequestId === null ? [] : [pullRequestId];
  if (number !== null) keys.push(`${repository.toLowerCase()}#${number}`);
  return keys;
}

function mergeLinkedIssues(
  ...groups: readonly (readonly PullRequestIssueContext[] | undefined)[]
): PullRequestIssueContext[] {
  const merged = new Map<string, PullRequestIssueContext>();
  for (const group of groups) {
    for (const context of group ?? []) merged.set(context.identifier, context);
  }
  return [...merged.values()];
}

export interface PullRequestActivityRow {
  readonly id: string;
  readonly type: string;
  readonly action: string;
  readonly actorLogin: string;
  readonly body: string;
  readonly bodyHtml: string;
  readonly url: string;
  readonly state: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly occurredAt: string;
}

export interface PullRequestDetail extends PullRequestRow {
  readonly body: string;
  readonly bodyHtml: string;
  readonly baseRef: string;
  readonly activities: readonly PullRequestActivityRow[];
}

export type GithubReach =
  | 'not_installed'
  | 'suspended'
  | 'no_repositories'
  | 'repositories_untracked'
  | 'connected';

async function currentPrincipal(principal: Principal): Promise<Principal | null> {
  const [[membership], teamRows] = await Promise.all([
    db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, principal.organizationId),
          eq(schema.member.userId, principal.userId),
        ),
      )
      .limit(1),
    db
      .select({ teamId: schema.teamMember.teamId })
      .from(schema.teamMember)
      .innerJoin(schema.team, eq(schema.team.id, schema.teamMember.teamId))
      .where(
        and(
          eq(schema.team.organizationId, principal.organizationId),
          eq(schema.teamMember.userId, principal.userId),
        ),
      ),
  ]);
  if (membership === undefined) return null;
  return {
    userId: principal.userId,
    organizationId: principal.organizationId,
    role: policyRole(membership.role),
    teamIds: teamRows.map((row) => row.teamId),
  };
}

async function reachableButUntracked(
  organizationId: string,
  watched: ReadonlySet<string>,
): Promise<boolean> {
  const visible = await db
    .select({ repositoryId: schema.githubRepository.repositoryId })
    .from(schema.githubRepository)
    .innerJoin(
      schema.githubInstallation,
      eq(schema.githubInstallation.id, schema.githubRepository.installationRowId),
    )
    .where(
      and(
        eq(schema.githubRepository.organizationId, organizationId),
        eq(schema.githubRepository.archived, false),
        eq(schema.githubInstallation.status, 'active'),
      ),
    );
  return visible.some((row) => !watched.has(row.repositoryId));
}

export async function githubReach(principal: Principal): Promise<GithubReach> {
  const [installations, tracked] = await Promise.all([
    db
      .select({
        integrationId: schema.githubInstallation.integrationId,
        status: schema.githubInstallation.status,
      })
      .from(schema.githubInstallation)
      .where(eq(schema.githubInstallation.organizationId, principal.organizationId)),
    db
      .select({
        integrationId: schema.githubRepositorySync.integrationId,
        repositoryId: schema.githubRepositorySync.repositoryId,
      })
      .from(schema.githubRepositorySync)
      .where(
        and(
          eq(schema.githubRepositorySync.organizationId, principal.organizationId),
          eq(schema.githubRepositorySync.enabled, true),
        ),
      ),
  ]);

  if (installations.length === 0) return tracked.length === 0 ? 'not_installed' : 'connected';

  const active = new Set(
    installations.filter((row) => row.status === 'active').map((row) => row.integrationId),
  );
  if (active.size === 0) return 'suspended';

  const reachable = tracked.filter((row) => active.has(row.integrationId));
  if (reachable.length === 0) return 'no_repositories';

  const watched = new Set(reachable.map((row) => row.repositoryId));
  return (await reachableButUntracked(principal.organizationId, watched))
    ? 'repositories_untracked'
    : 'connected';
}

export async function loadPullRequestPage(
  principal: Principal,
  page: number,
): Promise<PullRequestPage> {
  const livePrincipal = await currentPrincipal(principal);
  if (livePrincipal === null) return { pulls: [], hasMore: false, total: 0 };

  const currentPage = Math.max(1, page);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: schema.githubPullRequest.id,
        title: schema.githubPullRequest.title,
        url: schema.githubPullRequest.url,
        repository: schema.githubPullRequest.repositoryName,
        number: schema.githubPullRequest.number,
        branch: schema.githubPullRequest.headRef,
        state: schema.githubPullRequest.state,
        draft: schema.githubPullRequest.draft,
        merged: schema.githubPullRequest.merged,
        authorLogin: schema.githubPullRequest.authorLogin,
        reviewDecision: schema.githubPullRequest.reviewDecision,
        checkStatus: schema.githubPullRequest.checkStatus,
        updatedAt: schema.githubPullRequest.updatedAt,
      })
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.organizationId, principal.organizationId))
      .orderBy(desc(schema.githubPullRequest.updatedAt))
      .limit(PULL_REQUEST_PAGE_SIZE + 1)
      .offset((currentPage - 1) * PULL_REQUEST_PAGE_SIZE),
    db
      .select({ value: count() })
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.organizationId, principal.organizationId)),
  ]);
  const total = totals[0]?.value ?? 0;

  if (rows.length === 0) return { pulls: [], hasMore: false, total };
  const hasMore = rows.length > PULL_REQUEST_PAGE_SIZE;
  const visibleRows = rows.slice(0, PULL_REQUEST_PAGE_SIZE);
  const visibleLegacyLinks = visibleRows.flatMap((row) =>
    row.number === null
      ? []
      : [and(eq(schema.gitLink.repository, row.repository), eq(schema.gitLink.number, row.number))],
  );

  const [contexts, activityCounts] = await Promise.all([
    db
      .select({
        repository: schema.gitLink.repository,
        number: schema.gitLink.number,
        pullRequestId: schema.gitLink.pullRequestId,
        teamId: schema.issue.teamId,
        identifier: schema.issue.identifier,
        title: schema.issue.title,
        projectId: schema.project.id,
        projectName: schema.project.name,
        projectSlug: schema.project.slug,
      })
      .from(schema.gitLink)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.gitLink.issueId))
      .leftJoin(schema.project, eq(schema.project.id, schema.issue.projectId))
      .where(
        and(
          eq(schema.gitLink.organizationId, principal.organizationId),
          eq(schema.gitLink.kind, 'pull_request'),
          or(
            inArray(
              schema.gitLink.pullRequestId,
              visibleRows.map((row) => row.id),
            ),
            ...visibleLegacyLinks,
          ),
        ),
      ),
    db
      .select({
        pullRequestId: schema.githubPullRequestActivity.pullRequestId,
        total: count(schema.githubPullRequestActivity.id),
      })
      .from(schema.githubPullRequestActivity)
      .where(
        inArray(
          schema.githubPullRequestActivity.pullRequestId,
          visibleRows.map((row) => row.id),
        ),
      )
      .groupBy(schema.githubPullRequestActivity.pullRequestId),
  ]);

  const contextsByPull = new Map<string, PullRequestIssueContext[]>();
  for (const context of contexts) {
    if (
      !isInTeam(livePrincipal, {
        id: context.teamId,
        organizationId: principal.organizationId,
      })
    ) {
      continue;
    }
    const linkedIssue = {
      identifier: context.identifier,
      title: context.title,
      project:
        context.projectId === null || context.projectName === null || context.projectSlug === null
          ? null
          : { id: context.projectId, name: context.projectName, slug: context.projectSlug },
    };
    for (const key of pullRequestLinkKeys(
      context.pullRequestId,
      context.repository,
      context.number,
    )) {
      contextsByPull.set(key, [...(contextsByPull.get(key) ?? []), linkedIssue]);
    }
  }
  const activityByPull = new Map(activityCounts.map((entry) => [entry.pullRequestId, entry.total]));

  return {
    hasMore,
    total,
    pulls: visibleRows.map((row) => ({
      id: row.id,
      title: row.title.length > 0 ? row.title : `${row.repository}#${row.number ?? '?'}`,
      url: row.url,
      repository: row.repository,
      number: row.number,
      branch: row.branch.length === 0 ? null : row.branch,
      state: row.state,
      draft: row.draft,
      merged: row.merged,
      authorLogin: row.authorLogin,
      reviewDecision: row.reviewDecision,
      checkStatus: row.checkStatus,
      activityCount: activityByPull.get(row.id) ?? 0,
      linkedIssues: mergeLinkedIssues(
        contextsByPull.get(row.id),
        row.number === null
          ? undefined
          : contextsByPull.get(`${row.repository.toLowerCase()}#${row.number}`),
      ),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

export async function loadPullRequests(principal: Principal): Promise<PullRequestRow[]> {
  return (await loadPullRequestPage(principal, 1)).pulls;
}

export async function loadPullRequestDetail(
  principal: Principal,
  id: string,
): Promise<PullRequestDetail | null> {
  const livePrincipal = await currentPrincipal(principal);
  if (livePrincipal === null) return null;

  const [pull] = await db
    .select()
    .from(schema.githubPullRequest)
    .where(
      and(
        eq(schema.githubPullRequest.id, id),
        eq(schema.githubPullRequest.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  if (pull === undefined) return null;

  const contextMatch =
    pull.number === null
      ? eq(schema.gitLink.pullRequestId, pull.id)
      : or(
          eq(schema.gitLink.pullRequestId, pull.id),
          and(
            eq(schema.gitLink.repository, pull.repositoryName),
            eq(schema.gitLink.number, pull.number),
          ),
        );

  const [contexts, activities, activityTotals] = await Promise.all([
    db
      .select({
        teamId: schema.issue.teamId,
        identifier: schema.issue.identifier,
        title: schema.issue.title,
        projectId: schema.project.id,
        projectName: schema.project.name,
        projectSlug: schema.project.slug,
      })
      .from(schema.gitLink)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.gitLink.issueId))
      .leftJoin(schema.project, eq(schema.project.id, schema.issue.projectId))
      .where(
        and(
          eq(schema.gitLink.organizationId, principal.organizationId),
          eq(schema.gitLink.kind, 'pull_request'),
          contextMatch,
        ),
      ),
    db
      .select()
      .from(schema.githubPullRequestActivity)
      .where(eq(schema.githubPullRequestActivity.pullRequestId, pull.id))
      .orderBy(desc(schema.githubPullRequestActivity.occurredAt))
      .limit(PULL_REQUEST_ACTIVITY_LIMIT),
    db
      .select({ value: count() })
      .from(schema.githubPullRequestActivity)
      .where(eq(schema.githubPullRequestActivity.pullRequestId, pull.id)),
  ]);

  return {
    id: pull.id,
    title: pull.title.length > 0 ? pull.title : `${pull.repositoryName}#${pull.number ?? '?'}`,
    body: pull.body,
    bodyHtml: renderMarkdown(pull.body),
    url: pull.url,
    repository: pull.repositoryName,
    number: pull.number,
    branch: pull.headRef.length === 0 ? null : pull.headRef,
    baseRef: pull.baseRef,
    state: pull.state,
    draft: pull.draft,
    merged: pull.merged,
    authorLogin: pull.authorLogin,
    reviewDecision: pull.reviewDecision,
    checkStatus: pull.checkStatus,
    activityCount: activityTotals[0]?.value ?? 0,
    linkedIssues: mergeLinkedIssues(
      contexts.flatMap((context) => {
        if (
          !isInTeam(livePrincipal, {
            id: context.teamId,
            organizationId: principal.organizationId,
          })
        ) {
          return [];
        }
        return [
          {
            identifier: context.identifier,
            title: context.title,
            project:
              context.projectId === null ||
              context.projectName === null ||
              context.projectSlug === null
                ? null
                : { id: context.projectId, name: context.projectName, slug: context.projectSlug },
          },
        ];
      }),
    ),
    updatedAt: pull.updatedAt.toISOString(),
    activities: activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      action: activity.action,
      actorLogin: activity.actorLogin,
      body: activity.body,
      bodyHtml: renderMarkdown(activity.body),
      url: activity.url,
      state: activity.state,
      path: activity.path,
      line: activity.line,
      occurredAt: activity.occurredAt.toISOString(),
    })),
  };
}
