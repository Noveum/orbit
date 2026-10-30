import { attachIssueActors, type IssueActorColumns, type IssueActors } from '@orbit/core';
import { db, inArray, schema } from '@orbit/db';

export type DecoratedIssue<T> = T &
  IssueActors & {
    readonly organizationId: string;
    readonly labelIds: string[];
    readonly reviewerIds: string[];
  };

export async function attachIssueDecorations<T extends { id: string } & IssueActorColumns>(
  issues: readonly T[],
  organizationId: string,
): Promise<DecoratedIssue<T>[]> {
  if (issues.length === 0) return [];
  const issueIds = issues.map((issue) => issue.id);
  const [links, reviewerLinks, actors] = await Promise.all([
    db
      .select({ issueId: schema.issueLabel.issueId, labelId: schema.issueLabel.labelId })
      .from(schema.issueLabel)
      .where(inArray(schema.issueLabel.issueId, issueIds)),
    db
      .select({ issueId: schema.issueReviewer.issueId, userId: schema.issueReviewer.userId })
      .from(schema.issueReviewer)
      .where(inArray(schema.issueReviewer.issueId, issueIds)),
    attachIssueActors(db, organizationId, issues),
  ]);

  const byIssue = new Map<string, string[]>();
  for (const link of links) {
    const bucket = byIssue.get(link.issueId) ?? [];
    bucket.push(link.labelId);
    byIssue.set(link.issueId, bucket);
  }

  const reviewersByIssue = new Map<string, string[]>();
  for (const link of reviewerLinks) {
    const bucket = reviewersByIssue.get(link.issueId) ?? [];
    bucket.push(link.userId);
    reviewersByIssue.set(link.issueId, bucket);
  }
  for (const bucket of reviewersByIssue.values()) bucket.sort();

  return actors.map((issue) => ({
    ...issue,
    organizationId,
    labelIds: byIssue.get(issue.id) ?? [],
    reviewerIds: reviewersByIssue.get(issue.id) ?? [],
  }));
}
