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
import { escapeSlackText, SlackApiError } from '@orbit/services/slack';
import { dispatchSlackDmResult, SlackDmDispatchError } from '@orbit/services/slack/dispatch';
import type { SyncAction } from '@orbit/shared/events';
import type { Executor } from '../internal.ts';

export const NOTIFICATION_BODY_LIMIT = 240;

type SlackDmFinalizer = (input: {
  readonly deliveryId: string;
  readonly notificationId: string;
  readonly claimedAt: Date;
  readonly sent: boolean;
  readonly providerMessage: Awaited<ReturnType<typeof dispatchSlackDmResult>>;
}) => Promise<boolean>;

export interface SlackDmWorkerOptions {
  readonly concurrency?: number;
  readonly deadlineAt?: Date;
  readonly now?: () => Date;
}

const SLACK_DM_CONCURRENCY = 5;
const SLACK_DM_WORKER_WINDOW_MS = 270_000;
const PERMANENT_SLACK_DM_ERRORS = new Set([
  'cannot_dm_bot',
  'channel_not_found',
  'invalid_arg_name',
  'invalid_arguments',
  'invalid_array_arg',
  'is_archived',
  'msg_too_long',
  'no_text',
  'not_in_channel',
  'restricted_action',
  'restricted_action_read_only_channel',
  'too_many_attachments',
  'user_disabled',
  'user_not_found',
  'users_not_found',
]);

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
  dispatch: typeof dispatchSlackDmResult = dispatchSlackDmResult,
  finalize?: SlackDmFinalizer,
  options: SlackDmWorkerOptions & { readonly organizationId?: string } = {},
): Promise<number> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const deadlineAt =
    options.deadlineAt ?? new Date(startedAt.getTime() + SLACK_DM_WORKER_WINDOW_MS);
  const requestedConcurrency = options.concurrency ?? SLACK_DM_CONCURRENCY;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.min(SLACK_DM_CONCURRENCY, Math.floor(requestedConcurrency)))
    : SLACK_DM_CONCURRENCY;
  const maximumDeliveries = Math.max(0, Math.floor(limit));
  let delivered = 0;
  let claimedCount = 0;
  while (claimedCount < maximumDeliveries && now().getTime() < deadlineAt.getTime()) {
    const claimLimit = Math.min(concurrency, maximumDeliveries - claimedCount);
    const claimed = await claimSlackDmDeliveries(
      database,
      claimLimit,
      now(),
      true,
      options.organizationId,
    );
    if (claimed.length === 0) break;
    claimedCount += claimed.length;
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
    const outcomes = await Promise.all(
      claimed.map(async (delivery) => {
        const notification = byId.get(delivery.notificationId);
        if (notification === undefined) return 0;
        return await deliverClaimedSlackDm(
          database,
          delivery,
          notification,
          fetch,
          dispatch,
          finalize,
          now,
        );
      }),
    );
    delivered += outcomes.reduce((total, outcome) => total + outcome, 0);
  }
  return delivered;
}

async function deliverClaimedSlackDm(
  database: Database,
  delivery: Awaited<ReturnType<typeof claimSlackDmDeliveries>>[number],
  notification: typeof schema.notification.$inferSelect,
  fetch: typeof globalThis.fetch,
  dispatch: typeof dispatchSlackDmResult,
  finalize?: SlackDmFinalizer,
  now: () => Date = () => new Date(),
): Promise<number> {
  let providerMessage: Awaited<ReturnType<typeof dispatchSlackDmResult>>;
  try {
    providerMessage = await dispatch(database, {
      organizationId: notification.organizationId,
      userId: delivery.userId,
      text: `${escapeSlackText(notification.title)}: ${absoluteNotificationUrl(notification.externalUrl ?? notification.url)}`,
      fetch,
    });
  } catch (error) {
    console.error('[orbit] Slack DM delivery failed');
    await finalizeSlackDmFailure(database, notification.organizationId, delivery, error, now());
    return 0;
  }
  if (providerMessage.delivered === 0) {
    await markSlackDmUnavailable(database, delivery.id, delivery.claimedAt ?? new Date(0));
    return 0;
  }
  const sent =
    providerMessage.channel !== null &&
    providerMessage.channel.length > 0 &&
    providerMessage.ts !== null &&
    providerMessage.ts.length > 0;
  const finalizeDelivery: SlackDmFinalizer = async ({
    deliveryId,
    notificationId,
    claimedAt,
    sent,
    providerMessage,
  }) =>
    await database.transaction(async (tx) => {
      const updated = await markSlackDmDelivery(
        tx,
        deliveryId,
        claimedAt,
        sent,
        undefined,
        providerMessage,
      );
      if (updated && sent) {
        await markNotificationDelivered(tx, notificationId, 'slack_dm');
      }
      return updated;
    });
  const finalized = await (finalize ?? finalizeDelivery)({
    deliveryId: delivery.id,
    notificationId: notification.id,
    claimedAt: delivery.claimedAt ?? new Date(0),
    sent,
    providerMessage,
  });
  return finalized && sent ? 1 : 0;
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
  now: Date,
): Promise<void> {
  const cause = error instanceof SlackDmDispatchError ? error.cause : error;
  let code = '';
  if (error instanceof SlackDmDispatchError) code = error.slackCode ?? '';
  else if (cause instanceof SlackApiError) code = cause.code;
  if (
    [
      'invalid_auth',
      'account_inactive',
      'credential_unavailable',
      'missing_scope',
      'token_revoked',
    ].includes(code)
  ) {
    const reauthorizationMarked = await markSlackReauthorizationRequired(
      database,
      organizationId,
      error instanceof SlackDmDispatchError ? error.integrationId : undefined,
      error instanceof SlackDmDispatchError ? error.integrationVersion() : undefined,
    );
    if (reauthorizationMarked) {
      await markSlackDmUnavailable(
        database,
        delivery.id,
        delivery.claimedAt ?? new Date(0),
        code,
        true,
      );
      return;
    }
  }
  await markSlackDmDelivery(
    database,
    delivery.id,
    delivery.claimedAt ?? new Date(0),
    false,
    cause instanceof Error ? cause.message : 'delivery failed',
    undefined,
    {
      currentAttempts: delivery.attempts,
      now,
      permanent: PERMANENT_SLACK_DM_ERRORS.has(code),
      ...(cause instanceof SlackApiError && cause.retryAfterMs !== undefined
        ? { retryAfterMs: cause.retryAfterMs }
        : {}),
    },
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
