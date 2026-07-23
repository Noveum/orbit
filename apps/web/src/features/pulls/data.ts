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
