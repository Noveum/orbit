import {
  and,
  db,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  schema,
  sql,
  type Transaction,
} from '@orbit/db';
import { renderMarkdown } from '@orbit/services/markdown';
import {
  lockNotificationSubjectAccess,
  mutateNotificationConversations,
  refreshNotificationConversationAccess,
} from '@orbit/services/notifications';
import { NOTIFICATION_TYPES } from '@orbit/shared/constants';
import { notFound, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import {
  type InboxConversation,
  type InboxConversationMutation,
  type InboxConversationPage,
  type InboxCounterSnapshot,
  type InboxHistoryPage,
  idSchema,
  inboxConversationQuerySchema,
  inboxConversationReadSchema,
  inboxConversationSnoozeSchema,
  inboxCursorSchema,
  inboxHistoryQuerySchema,
} from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import type { Executor } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';

type ConversationRow = typeof schema.notificationConversation.$inferSelect;

export function encodeInboxCursor(sequence: number, id: string): string {
  return Buffer.from(JSON.stringify({ sequence, id })).toString('base64url');
}

function decodeInboxCursor(cursor: string | undefined) {
  if (cursor === undefined) return null;
  try {
    return inboxCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw validationFailed('That inbox cursor is invalid. Start from the first page.');
  }
}

function notificationType(type: string | null) {
  return NOTIFICATION_TYPES.find((value) => value === type) ?? 'subscription_activity';
}

export function conversationSummary(row: ConversationRow): InboxConversation {
  return {
    id: row.id,
    conversationKey: row.conversationKey,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    category: row.category === 'status' ? 'status' : 'activity',
    latestEventId: row.latestEventId,
    type: notificationType(row.latestType),
    actorName: row.latestActorName ?? '',
    title: row.latestTitle ?? 'New activity',
    body: row.latestBody ?? '',
    bodyHtml: renderMarkdown(row.latestBody ?? ''),
    url: row.latestUrl ?? '/inbox',
    externalUrl: row.latestExternalUrl,
    occurredAt: row.latestOccurredAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    lastActivitySeq: row.lastActivitySeq,
    eventCount: row.eventCount,
    unreadEventCount: row.unreadEventCount,
    unreadMentionCount: row.unreadMentionCount,
    hasMention: row.lastMentionAt !== null,
    read: row.unreadEventCount === 0 && !row.manualUnread,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    syncId: row.syncId,
  };
}

async function counterSnapshot(
  executor: Executor,
  principal: Principal,
): Promise<InboxCounterSnapshot> {
  const [state] = await executor
    .select()
    .from(schema.notificationInboxState)
    .where(
      and(
        eq(schema.notificationInboxState.organizationId, principal.organizationId),
        eq(schema.notificationInboxState.userId, principal.userId),
      ),
    );
  return {
    counters: {
      unreadCount: state?.unreadCount ?? 0,
      unreadActivityCount: state?.unreadActivityCount ?? 0,
      unreadMentionCount: state?.unreadMentionCount ?? 0,
    },
    counterVersion: state?.syncId ?? 0,
  };
}

function ownerPredicate(principal: Principal) {
  return and(
    eq(schema.notificationConversation.organizationId, principal.organizationId),
    eq(schema.notificationConversation.userId, principal.userId),
  );
}

function visiblePredicate(now: Date) {
  return and(
    isNull(schema.notificationConversation.dismissedAt),
    isNull(schema.notificationConversation.accessHiddenAt),
    sql`${schema.notificationConversation.eventCount} > 0`,
    or(
      isNull(schema.notificationConversation.snoozedUntil),
      lte(schema.notificationConversation.snoozedUntil, now),
    ),
  );
}

export async function listInboxConversations(
  principal: Principal,
  input: unknown = {},
): Promise<InboxConversationPage> {
  const query = inboxConversationQuerySchema.parse(input);
  const cursor = decodeInboxCursor(query.cursor);
  return await db.transaction(async (tx) => {
    const now = new Date();
    await refreshNotificationConversationAccess(
      tx,
      principal.organizationId,
      principal.userId,
      now,
    );
    const c = schema.notificationConversation;
    const tabs = {
      activity: eq(c.category, 'activity'),
      status: eq(c.category, 'status'),
      unread: sql`${c.unreadEventCount} > 0 or ${c.manualUnread} is true`,
      mentions: sql`${c.lastMentionAt} is not null`,
      pulls: eq(c.subjectType, 'github_pull_request'),
    };
    const rows = await tx
      .select()
      .from(c)
      .where(
        and(
          ownerPredicate(principal),
          visiblePredicate(now),
          tabs[query.tab],
          cursor === null
            ? undefined
            : or(
                lt(c.lastActivitySeq, cursor.sequence),
                and(eq(c.lastActivitySeq, cursor.sequence), lt(c.id, cursor.id)),
              ),
        ),
      )
      .orderBy(desc(c.lastActivitySeq), desc(c.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      conversations: page.map(conversationSummary),
      ...(await counterSnapshot(tx, principal)),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeInboxCursor(last.lastActivitySeq, last.id)
          : null,
    };
  });
}

async function authorizedConversation(executor: Transaction, principal: Principal, id: string) {
  const [row] = await executor
    .select()
    .from(schema.notificationConversation)
    .where(and(ownerPredicate(principal), eq(schema.notificationConversation.id, id)));
  if (
    row === undefined ||
    !(await lockNotificationSubjectAccess(executor, {
      organizationId: row.organizationId,
      userId: principal.userId,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
    }))
  )
    throw notFound('That inbox conversation is not available.');
  return row;
}

export async function getInboxConversation(
  principal: Principal,
  inputId: string,
): Promise<InboxConversationMutation> {
  const id = idSchema.parse(inputId);
  return await db.transaction(async (tx) => {
    await refreshNotificationConversationAccess(tx, principal.organizationId, principal.userId);
    const row = await authorizedConversation(tx, principal, id);
    return { conversations: [conversationSummary(row)], ...(await counterSnapshot(tx, principal)) };
  });
}

export async function listInboxConversationEvents(
  principal: Principal,
  inputId: string,
  input: unknown = {},
): Promise<InboxHistoryPage> {
  const id = idSchema.parse(inputId);
  const query = inboxHistoryQuerySchema.parse(input);
  const cursor = decodeInboxCursor(query.cursor);
  return await db.transaction(async (tx) => {
    await authorizedConversation(tx, principal, id);
    const n = schema.notification;
    const rows = await tx
      .select()
      .from(n)
      .where(
        and(
          eq(n.organizationId, principal.organizationId),
          eq(n.userId, principal.userId),
          eq(n.conversationId, id),
          eq(n.surfaceInInbox, true),
          isNull(n.deduplicatedIntoNotificationId),
          cursor === null
            ? undefined
            : or(
                lt(n.ingestionSeq, cursor.sequence),
                and(eq(n.ingestionSeq, cursor.sequence), lt(n.id, cursor.id)),
              ),
        ),
      )
      .orderBy(desc(n.ingestionSeq), desc(n.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      events: page.map((row) => ({
        id: row.id,
        type: notificationType(row.type),
        actorName: row.actorName,
        title: row.title,
        body: row.body,
        bodyHtml: renderMarkdown(row.body),
        url: row.url,
        externalUrl: row.externalUrl,
        occurredAt: (row.occurredAt ?? row.createdAt).toISOString(),
        ingestionSeq: row.ingestionSeq ?? row.syncId,
      })),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeInboxCursor(last.ingestionSeq ?? last.syncId, last.id)
          : null,
    };
  });
}

interface ConversationMutationInput {
  readonly conversationIds?: readonly string[];
  readonly kind: 'read' | 'snooze' | 'dismiss';
  readonly read?: boolean;
  readonly until?: Date | null;
}

async function mutateConversations(principal: Principal, input: ConversationMutationInput) {
  return await db.transaction(async (tx) => {
    const now = new Date();
    await refreshNotificationConversationAccess(
      tx,
      principal.organizationId,
      principal.userId,
      now,
    );
    const candidates = await tx
      .select()
      .from(schema.notificationConversation)
      .where(
        and(
          ownerPredicate(principal),
          input.conversationIds === undefined
            ? visiblePredicate(now)
            : inArray(schema.notificationConversation.id, [...input.conversationIds]),
          isNull(schema.notificationConversation.accessHiddenAt),
        ),
      )
      .orderBy(schema.notificationConversation.conversationKey);
    if (
      input.conversationIds !== undefined &&
      candidates.length !== new Set(input.conversationIds).size
    ) {
      throw notFound('Some inbox conversations are not available.');
    }
    const rows = await mutateNotificationConversations(tx, {
      organizationId: principal.organizationId,
      userId: principal.userId,
      conversationIds: candidates.map((row) => row.id),
      kind: input.kind,
      now,
      ...(input.read === undefined ? {} : { read: input.read }),
      ...(input.until === undefined ? {} : { until: input.until }),
    });
    const snapshot = await counterSnapshot(tx, principal);
    const actor = await principalActor(tx, principal);
    const actions: SyncAction[] = rows.map((row) =>
      buildSyncAction({
        syncId: row.syncId,
        organizationId: row.organizationId,
        scopes: [scopes.user(row.userId)],
        action: 'update',
        model: 'notification_conversation',
        modelId: row.id,
        data: {
          id: row.id,
          syncId: row.syncId,
          lastActivitySeq: row.lastActivitySeq,
          visible:
            row.dismissedAt === null &&
            row.accessHiddenAt === null &&
            (row.snoozedUntil === null || row.snoozedUntil <= now),
          ...snapshot,
        },
        actor,
      }),
    );
    return { conversations: rows.map(conversationSummary), ...snapshot, actions };
  });
}

export async function markInboxConversationsRead(principal: Principal, input: unknown) {
  const parsed = inboxConversationReadSchema.parse(input);
  return await mutateConversations(principal, { kind: 'read', ...parsed });
}

export async function markAllInboxConversationsRead(principal: Principal) {
  return await mutateConversations(principal, { kind: 'read', read: true });
}

export async function snoozeInboxConversation(
  principal: Principal,
  inputId: string,
  input: unknown,
) {
  const id = idSchema.parse(inputId);
  const parsed = inboxConversationSnoozeSchema.parse(input);
  const until = parsed.snoozedUntil === null ? null : new Date(parsed.snoozedUntil);
  if (until !== null && until <= new Date()) throw validationFailed('Choose a future snooze time.');
  return await mutateConversations(principal, { conversationIds: [id], kind: 'snooze', until });
}

export async function dismissInboxConversation(principal: Principal, inputId: string) {
  return await mutateConversations(principal, {
    conversationIds: [idSchema.parse(inputId)],
    kind: 'dismiss',
  });
}
