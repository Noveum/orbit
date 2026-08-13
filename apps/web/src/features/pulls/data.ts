import { and, count, db, desc, eq, exists, inArray, or, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';

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
}

export const PULL_REQUEST_PAGE_SIZE = 100;

export interface PullRequestActivityRow {
  readonly id: string;
  readonly type: string;
  readonly action: string;
  readonly actorLogin: string;
  readonly body: string;
  readonly url: string;
  readonly state: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly occurredAt: string;
}

export interface PullRequestDetail extends PullRequestRow {
  readonly body: string;
  readonly baseRef: string;
  readonly activities: readonly PullRequestActivityRow[];
}

export type GithubReach =
  | 'not_installed'
  | 'suspended'
  | 'no_repositories'
  | 'repositories_untracked'
  | 'connected';

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
  const [membership] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, principal.organizationId),
        eq(schema.member.userId, principal.userId),
      ),
    )
    .limit(1);
  if (membership === undefined) return { pulls: [], hasMore: false };

  const currentPage = Math.max(1, page);

  const rows = await db
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
    .offset((currentPage - 1) * PULL_REQUEST_PAGE_SIZE);

  if (rows.length === 0) return { pulls: [], hasMore: false };
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
          membership.role === 'admin'
            ? undefined
            : exists(
                db
                  .select({ id: schema.teamMember.id })
                  .from(schema.teamMember)
                  .where(
                    and(
                      eq(schema.teamMember.teamId, schema.issue.teamId),
                      eq(schema.teamMember.userId, principal.userId),
                    ),
                  ),
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
    if (context.number === null) continue;
    const key = context.pullRequestId ?? `${context.repository.toLowerCase()}#${context.number}`;
    contextsByPull.set(key, [
      ...(contextsByPull.get(key) ?? []),
      {
        identifier: context.identifier,
        title: context.title,
        project:
          context.projectId === null || context.projectName === null || context.projectSlug === null
            ? null
            : { id: context.projectId, name: context.projectName, slug: context.projectSlug },
      },
    ]);
  }
  const activityByPull = new Map(activityCounts.map((entry) => [entry.pullRequestId, entry.total]));

  return {
    hasMore,
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
      linkedIssues:
        contextsByPull.get(row.id) ??
        contextsByPull.get(`${row.repository.toLowerCase()}#${row.number}`) ??
        [],
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
  const [membership] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, principal.organizationId),
        eq(schema.member.userId, principal.userId),
      ),
    )
    .limit(1);
  if (membership === undefined) return null;

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

  const [contexts, activities] = await Promise.all([
    db
      .select({
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
            eq(schema.gitLink.pullRequestId, pull.id),
            and(
              eq(schema.gitLink.repository, pull.repositoryName),
              eq(schema.gitLink.number, pull.number),
            ),
          ),
          membership.role === 'admin'
            ? undefined
            : exists(
                db
                  .select({ id: schema.teamMember.id })
                  .from(schema.teamMember)
                  .where(
                    and(
                      eq(schema.teamMember.teamId, schema.issue.teamId),
                      eq(schema.teamMember.userId, principal.userId),
                    ),
                  ),
              ),
        ),
      ),
    db
      .select()
      .from(schema.githubPullRequestActivity)
      .where(eq(schema.githubPullRequestActivity.pullRequestId, pull.id))
      .orderBy(desc(schema.githubPullRequestActivity.occurredAt)),
  ]);

  return {
    id: pull.id,
    title: pull.title.length > 0 ? pull.title : `${pull.repositoryName}#${pull.number}`,
    body: pull.body,
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
    activityCount: activities.length,
    linkedIssues: contexts.map((context) => ({
      identifier: context.identifier,
      title: context.title,
      project:
        context.projectId === null || context.projectName === null || context.projectSlug === null
          ? null
          : { id: context.projectId, name: context.projectName, slug: context.projectSlug },
    })),
    updatedAt: pull.updatedAt.toISOString(),
    activities: activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      action: activity.action,
      actorLogin: activity.actorLogin,
      body: activity.body,
      url: activity.url,
      state: activity.state,
      path: activity.path,
      line: activity.line,
      occurredAt: activity.occurredAt.toISOString(),
    })),
  };
}
