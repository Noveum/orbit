import { and, type Database, db, eq, inArray, isNull, or, schema } from '@orbit/db';
import {
  deliverNotificationProviders,
  type NotificationEvent,
  type NotificationProviderWorkerOptions,
  notifyMany,
} from '@orbit/services/notifications';
import type { SyncAction } from '@orbit/shared/events';
import type { Executor } from '../internal.ts';

export const NOTIFICATION_BODY_LIMIT = 240;

export async function notifyRecipients(
  executor: Executor,
  events: readonly NotificationEvent[],
): Promise<SyncAction[]> {
  if (events.length === 0) return [];
  const outcome = await notifyMany(executor, events);
  return outcome.actions;
}

export async function deliverPendingSlackDms(
  database: Database = db,
  limit = 100,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  options: Omit<NotificationProviderWorkerOptions, 'channels' | 'limit' | 'fetch'> = {},
): Promise<number> {
  return await deliverNotificationProviders(database, {
    ...options,
    channels: ['slack_dm'],
    limit,
    fetch,
  });
}

export async function deliverPendingSlackChannels(
  database: Database = db,
  limit = 100,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  options: Omit<NotificationProviderWorkerOptions, 'channels' | 'limit' | 'fetch'> = {},
): Promise<number> {
  return await deliverNotificationProviders(database, {
    ...options,
    channels: ['slack'],
    limit,
    fetch,
  });
}

export async function deliverPendingNotificationEmails(
  database: Database = db,
  limit = 100,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  options: Omit<NotificationProviderWorkerOptions, 'channels' | 'limit' | 'fetch'> = {},
): Promise<number> {
  return await deliverNotificationProviders(database, {
    ...options,
    channels: ['email'],
    limit,
    fetch,
  });
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
