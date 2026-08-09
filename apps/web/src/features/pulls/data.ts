import { and, db, desc, eq, or, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';

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
  readonly issueIdentifier: string;
  readonly issueTitle: string;
  readonly updatedAt: string;
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

export async function loadPullRequests(principal: Principal): Promise<PullRequestRow[]> {
  const rows = await db
    .select({
      id: schema.gitLink.id,
      title: schema.gitLink.title,
      url: schema.gitLink.url,
      repository: schema.gitLink.repository,
      number: schema.gitLink.number,
      branch: schema.gitLink.branch,
      state: schema.gitLink.state,
      draft: schema.gitLink.draft,
      merged: schema.gitLink.merged,
      issueIdentifier: schema.issue.identifier,
      issueTitle: schema.issue.title,
      updatedAt: schema.gitLink.updatedAt,
    })
    .from(schema.gitLink)
    .innerJoin(schema.issue, eq(schema.issue.id, schema.gitLink.issueId))
    .where(
      and(
        eq(schema.gitLink.organizationId, principal.organizationId),
        eq(schema.gitLink.kind, 'pull_request'),
        or(
          eq(schema.issue.assigneeId, principal.userId),
          eq(schema.issue.creatorId, principal.userId),
        ),
      ),
    )
    .orderBy(desc(schema.gitLink.updatedAt))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    title: row.title.length > 0 ? row.title : `${row.repository}#${row.number ?? '?'}`,
    url: row.url,
    repository: row.repository,
    number: row.number,
    branch: row.branch,
    state: row.state,
    draft: row.draft,
    merged: row.merged,
    issueIdentifier: row.issueIdentifier,
    issueTitle: row.issueTitle,
    updatedAt: row.updatedAt.toISOString(),
  }));
}
