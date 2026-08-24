import { and, type Database, db, eq, inArray, isNull, or, schema } from '@orbit/db';
import type { NotificationEvent } from '@orbit/services/notifications';
import {
  claimSlackDmDeliveries,
  markNotificationDelivered,
  markSlackDmDelivery,
  markSlackDmUnavailable,
  markSlackReauthorizationRequired,
  notifyMany,
} from '@orbit/services/notifications';
import { SlackApiError } from '@orbit/services/slack';
import {
  dispatchSlackDmResult,
  SlackDmDispatchError,
  slackDmAvailable,
} from '@orbit/services/slack/dispatch';
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

export async function deliverPendingSlackDms(
  database: Database = db,
  limit = 100,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<number> {
  const claimed = await claimSlackDmDeliveries(database, limit, new Date(), true);
  if (claimed.length === 0) return 0;
  const rows = await database
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
    if (notification === undefined) {
      continue;
    }
    if (!(await slackDmAvailable(database, notification.organizationId, delivery.userId))) {
      await markSlackDmUnavailable(database, delivery.id, delivery.claimedAt ?? new Date(0));
      continue;
    }
    let sent = 0;
    let providerMessage: { channel: string | null; ts: string | null } | undefined;
    try {
      providerMessage = await dispatchSlackDmResult(database, {
        organizationId: notification.organizationId,
        userId: delivery.userId,
        text: `${notification.title}: ${absoluteNotificationUrl(notification.externalUrl ?? notification.url)}`,
        fetch,
      });
      sent = providerMessage.channel !== null && providerMessage.ts !== null ? 1 : 0;
    } catch (error) {
      console.error('[orbit] Slack DM retry failed', error);
      await finalizeSlackDmFailure(database, notification.organizationId, delivery, error);
      continue;
    }
    const finalized = await database.transaction(async (tx) => {
      const updated = await markSlackDmDelivery(
        tx,
        delivery.id,
        delivery.claimedAt ?? new Date(0),
        sent === 1,
        undefined,
        providerMessage,
      );
      if (updated && sent === 1) {
        await markNotificationDelivered(tx, notification.id, 'slack_dm');
      }
      return updated;
    });
    if (finalized && sent === 1) {
      delivered += 1;
    }
  }
  return delivered;
}

function absoluteNotificationUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env['NEXT_PUBLIC_APP_URL'] ?? process.env['APP_URL'] ?? '';
  if (base.length === 0) throw new Error('APP_URL is required for Slack notification links');
  try {
    const parsedBase = new URL(base);
    if (!/^https?:$/.test(parsedBase.protocol))
      throw new Error('APP_URL must be an absolute HTTP URL');
    return new URL(url, parsedBase).toString();
  } catch {
    throw new Error('APP_URL must be an absolute HTTP URL');
  }
}

async function finalizeSlackDmFailure(
  database: Database,
  organizationId: string,
  delivery: Awaited<ReturnType<typeof claimSlackDmDeliveries>>[number],
  error: unknown,
): Promise<void> {
  const cause = error instanceof SlackDmDispatchError ? error.cause : error;
  let code = '';
  if (error instanceof SlackDmDispatchError) code = error.slackCode ?? '';
  else if (cause instanceof SlackApiError) code = cause.code;
  if (['invalid_auth', 'account_inactive', 'missing_scope', 'token_revoked'].includes(code)) {
    await markSlackReauthorizationRequired(
      database,
      organizationId,
      error instanceof SlackDmDispatchError ? error.integrationId : undefined,
      error instanceof SlackDmDispatchError ? error.tokenUsed() : undefined,
    );
    await markSlackDmUnavailable(
      database,
      delivery.id,
      delivery.claimedAt ?? new Date(0),
      code,
      true,
    );
    return;
  }
  await markSlackDmDelivery(
    database,
    delivery.id,
    delivery.claimedAt ?? new Date(0),
    false,
    cause instanceof Error ? cause.message : 'delivery failed',
  );
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
