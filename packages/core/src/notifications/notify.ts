import { and, eq, inArray, isNull, or, schema } from '@orbit/db';
import type { NotificationEvent } from '@orbit/services/notifications';
import { notifyMany } from '@orbit/services/notifications';
import type { SyncAction } from '@orbit/shared/events';
import type { Executor } from '../internal.ts';

export const NOTIFICATION_BODY_LIMIT = 240;

export async function notifyRecipients(
  executor: Executor,
  events: readonly NotificationEvent[],
): Promise<SyncAction[]> {
  const populated = events.filter((event) => event.userIds.length > 0);
  if (populated.length === 0) return [];
  const outcome = await notifyMany(executor, populated);
  return outcome.actions;
}

export async function issueSubscriberIds(executor: Executor, issueId: string): Promise<string[]> {
  const rows = await executor
    .select({ userId: schema.issueSubscription.userId })
    .from(schema.issueSubscription)
    .where(eq(schema.issueSubscription.issueId, issueId));
  return rows.map((row) => row.userId);
}

export async function issueSubscribersByIssue(
  executor: Executor,
  issueIds: readonly string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (issueIds.length === 0) return grouped;
  const rows = await executor
    .select({
      issueId: schema.issueSubscription.issueId,
      userId: schema.issueSubscription.userId,
    })
    .from(schema.issueSubscription)
    .where(inArray(schema.issueSubscription.issueId, [...issueIds]));
  for (const row of rows) {
    const bucket = grouped.get(row.issueId) ?? [];
    bucket.push(row.userId);
    grouped.set(row.issueId, bucket);
  }
  return grouped;
}

export async function docSubscriberIds(executor: Executor, docId: string): Promise<string[]> {
  const rows = await executor
    .select({ userId: schema.docSubscription.userId })
    .from(schema.docSubscription)
    .where(and(eq(schema.docSubscription.docId, docId), eq(schema.docSubscription.muted, false)));
  return rows.map((row) => row.userId);
}

export async function commentThreadAuthors(
  executor: Executor,
  rootCommentId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ authorId: schema.comment.authorId })
    .from(schema.comment)
    .where(
      and(
        or(eq(schema.comment.id, rootCommentId), eq(schema.comment.parentId, rootCommentId)),
        isNull(schema.comment.deletedAt),
      ),
    );
  return rows.map((row) => row.authorId);
}

export async function docCommentThreadAuthors(
  executor: Executor,
  rootCommentId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ authorId: schema.docComment.authorId })
    .from(schema.docComment)
    .where(
      and(
        or(eq(schema.docComment.id, rootCommentId), eq(schema.docComment.parentId, rootCommentId)),
        isNull(schema.docComment.deletedAt),
      ),
    );
  return rows.map((row) => row.authorId);
}
