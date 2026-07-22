import type { IssueRow } from '@orbit/core';
import { db, inArray, schema } from '@orbit/db';

export interface IssueWithLabels extends IssueRow {
  readonly labelIds: string[];
}

export async function attachLabels(issues: readonly IssueRow[]): Promise<IssueWithLabels[]> {
  if (issues.length === 0) return [];
  const links = await db
    .select({ issueId: schema.issueLabel.issueId, labelId: schema.issueLabel.labelId })
    .from(schema.issueLabel)
    .where(
      inArray(
        schema.issueLabel.issueId,
        issues.map((issue) => issue.id),
      ),
    );

  const byIssue = new Map<string, string[]>();
  for (const link of links) {
    const bucket = byIssue.get(link.issueId) ?? [];
    bucket.push(link.labelId);
    byIssue.set(link.issueId, bucket);
  }

  return issues.map((issue) => ({ ...issue, labelIds: byIssue.get(issue.id) ?? [] }));
}
