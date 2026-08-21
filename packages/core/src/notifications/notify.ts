import { and, eq, inArray, isNull, or, schema } from '@orbit/db';
import type { NotificationEvent } from '@orbit/services/notifications';
import {
  claimSlackDmDeliveries,
  markNotificationDelivered,
  markSlackDmDelivery,
  markSlackDmUnavailable,
  notifyMany,
} from '@orbit/services/notifications';
import { dispatchSlackDm, slackDmAvailable } from '@orbit/services/slack/dispatch';
import type { SyncAction } from '@orbit/shared/events';
import type { Executor } from '../internal.ts';

export const NOTIFICATION_BODY_LIMIT = 240;

export async function notifyRecipients(
  executor: Executor,
  events: readonly NotificationEvent[],
): Promise<SyncAction[]> {
  const populated = events.filter((event) => event.userIds.length > 0);
  if (populated.length === 0) {
    await retrySlackDmDeliveries(executor);
    return [];
  }
  const outcome = await notifyMany(executor, populated);
  for (const dispatch of outcome.slackDm) {
    if (dispatch.sendAt > new Date()) continue;
    const notification = outcome.notifications.find((item) => item.id === dispatch.notificationId);
    if (notification === undefined) continue;
    if (!(await slackDmAvailable(executor, notification.organizationId, dispatch.userId))) {
      await markSlackDmUnavailable(executor, notification.id, dispatch.userId);
      continue;
    }
    let delivered = 0;
    try {
      delivered = await dispatchSlackDm(executor, {
        organizationId: notification.organizationId,
        userId: dispatch.userId,
        clientMsgId: dispatch.notificationId,
        text: `${notification.title}: ${notification.externalUrl ?? notification.url}`,
      });
    } catch (error) {
      console.error('[orbit] slack DM delivery deferred for retry', error);
    }
    if (delivered === 1) {
      await markNotificationDelivered(executor, notification.id, 'slack_dm');
      await markSlackDmDelivery(executor, notification.id, dispatch.userId, true);
    } else {
      await markSlackDmDelivery(executor, notification.id, dispatch.userId, false);
    }
  }
  await retrySlackDmDeliveries(executor);
  return outcome.actions;
}

export async function retrySlackDmDeliveries(executor: Executor, limit = 100): Promise<number> {
  const claimed = await claimSlackDmDeliveries(executor, limit);
  if (claimed.length === 0) return 0;
  const rows = await executor
    .select()
    .from(schema.notification)
    .where(
      inArray(
        schema.notification.id,
        claimed.map((row) => row.notificationId),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  let delivered = 0;
  for (const delivery of claimed) {
    const notification = byId.get(delivery.notificationId);
    if (notification === undefined) continue;
    if (!(await slackDmAvailable(executor, notification.organizationId, delivery.userId))) {
      await markSlackDmUnavailable(executor, notification.id, delivery.userId);
      continue;
    }
    let sent = 0;
    try {
      sent = await dispatchSlackDm(executor, {
        organizationId: notification.organizationId,
        userId: delivery.userId,
        clientMsgId: notification.id,
        text: `${notification.title}: ${notification.externalUrl ?? notification.url}`,
      });
    } catch (error) {
      console.error('[orbit] Slack DM retry failed', error);
    }
    await markSlackDmDelivery(executor, notification.id, delivery.userId, sent === 1);
    if (sent === 1) {
      delivered += 1;
      await markNotificationDelivered(executor, notification.id, 'slack_dm');
    }
  }
  return delivered;
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
