import { db, inArray, schema } from '@orbit/db';

export type WithLabels<T> = T & { readonly labelIds: string[] };

export async function attachLabels<T extends { id: string }>(
  issues: readonly T[],
): Promise<WithLabels<T>[]> {
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
