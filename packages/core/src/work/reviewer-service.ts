import { inArray, schema } from '@orbit/db';
import type { Executor } from '../internal.ts';

export async function reviewerIdsByIssue(
  executor: Executor,
  issueIds: readonly string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  const ids = [...new Set(issueIds)];
  if (ids.length === 0) return grouped;
  const rows = await executor
    .select({ issueId: schema.issueReviewer.issueId, userId: schema.issueReviewer.userId })
    .from(schema.issueReviewer)
    .where(inArray(schema.issueReviewer.issueId, ids));
  for (const row of rows) {
    const bucket = grouped.get(row.issueId) ?? [];
    bucket.push(row.userId);
    grouped.set(row.issueId, bucket);
  }
  for (const bucket of grouped.values()) bucket.sort();
  return grouped;
}

export async function replaceReviewersFor(
  executor: Executor,
  issueIds: readonly string[],
  reviewerIds: readonly string[],
): Promise<void> {
  const issues = [...new Set(issueIds)];
  if (issues.length === 0) return;
  await executor.delete(schema.issueReviewer).where(inArray(schema.issueReviewer.issueId, issues));
  const reviewers = [...new Set(reviewerIds)].sort();
  if (reviewers.length === 0) return;
  await executor
    .insert(schema.issueReviewer)
    .values(issues.flatMap((issueId) => reviewers.map((userId) => ({ issueId, userId }))))
    .onConflictDoNothing();
}
