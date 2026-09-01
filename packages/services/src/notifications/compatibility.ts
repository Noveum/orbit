import type { Database, Transaction } from '@orbit/db';
import {
  nextSyncId,
  notification,
  notificationConversation,
  notificationInboxState,
  notificationSnoozeWake,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  applyLiveConversationEvent,
  type ConversationAggregate,
  type ConversationIdentity,
} from './conversations.ts';

type CompatibilityDatabase = Database | Transaction;
type NotificationRow = typeof notification.$inferSelect;
type ConversationRow = typeof notificationConversation.$inferSelect;

export interface NotificationConversationPlan {
  readonly notificationId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly conversation: ConversationIdentity;
}

export interface LegacyNotificationMutationInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly kind: 'read' | 'read_all' | 'snooze' | 'dismiss';
  readonly notificationIds?: readonly string[];
  readonly read?: boolean;
  readonly until?: Date;
  readonly now: Date;
}

function recipientKey(organizationId: string, userId: string): string {
  return JSON.stringify([organizationId, userId]);
}

export function notificationConversationLookupKey(
  organizationId: string,
  userId: string,
  key: string,
): string {
  return JSON.stringify([organizationId, userId, key]);
}

function uniqueRecipients(
  plans: readonly Pick<NotificationConversationPlan, 'organizationId' | 'userId'>[],
): Array<{ organizationId: string; userId: string }> {
  const recipients = new Map<string, { organizationId: string; userId: string }>();
  for (const plan of plans) {
    recipients.set(recipientKey(plan.organizationId, plan.userId), {
      organizationId: plan.organizationId,
      userId: plan.userId,
    });
  }
  return [...recipients.values()].sort((left, right) =>
    recipientKey(left.organizationId, left.userId).localeCompare(
      recipientKey(right.organizationId, right.userId),
    ),
  );
}

function inboxStateRecipientPredicate(
  recipients: readonly { organizationId: string; userId: string }[],
) {
  return or(
    ...recipients.map((recipient) =>
      and(
        eq(notificationInboxState.organizationId, recipient.organizationId),
        eq(notificationInboxState.userId, recipient.userId),
      ),
    ),
  );
}

function conversationRecipientPredicate(
  recipients: readonly { organizationId: string; userId: string }[],
) {
  return or(
    ...recipients.map((recipient) =>
      and(
        eq(notificationConversation.organizationId, recipient.organizationId),
        eq(notificationConversation.userId, recipient.userId),
      ),
    ),
  );
}

async function ensureAndLockInboxStates(
  database: CompatibilityDatabase,
  recipients: readonly { organizationId: string; userId: string }[],
  now: Date,
): Promise<void> {
  if (recipients.length === 0) return;
  await database
    .insert(notificationInboxState)
    .values(
      recipients.map((recipient) => ({
        organizationId: recipient.organizationId,
        userId: recipient.userId,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
  const predicate = inboxStateRecipientPredicate(recipients);
  if (predicate === undefined) return;
  await database
    .select({
      organizationId: notificationInboxState.organizationId,
      userId: notificationInboxState.userId,
    })
    .from(notificationInboxState)
    .where(predicate)
    .orderBy(notificationInboxState.organizationId, notificationInboxState.userId)
    .for('update');
}

export async function prepareNotificationConversations(
  database: CompatibilityDatabase,
  plans: readonly NotificationConversationPlan[],
  now: Date,
): Promise<Map<string, ConversationRow>> {
  if (plans.length === 0) return new Map();
  const recipients = uniqueRecipients(plans);
  await ensureAndLockInboxStates(database, recipients, now);
  const shells = new Map<string, NotificationConversationPlan & { readonly id: string }>();
  for (const plan of plans) {
    const key = notificationConversationLookupKey(
      plan.organizationId,
      plan.userId,
      plan.conversation.conversationKey,
    );
    if (shells.has(key)) continue;
    shells.set(key, { ...plan, id: randomUUIDv7(now) });
  }
  const ordered = [...shells.values()].sort((left, right) =>
    notificationConversationLookupKey(
      left.organizationId,
      left.userId,
      left.conversation.conversationKey,
    ).localeCompare(
      notificationConversationLookupKey(
        right.organizationId,
        right.userId,
        right.conversation.conversationKey,
      ),
    ),
  );
  await database
    .insert(notificationConversation)
    .values(
      ordered.map((entry) => ({
        id: entry.id,
        organizationId: entry.organizationId,
        userId: entry.userId,
        conversationKey: entry.conversation.conversationKey,
        subjectType: entry.conversation.subjectType,
        subjectId: entry.conversation.subjectId,
        category: entry.conversation.category,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
  const predicate = or(
    ...ordered.map((entry) =>
      and(
        eq(notificationConversation.organizationId, entry.organizationId),
        eq(notificationConversation.userId, entry.userId),
        eq(notificationConversation.conversationKey, entry.conversation.conversationKey),
      ),
    ),
  );
  if (predicate === undefined) return new Map();
  const rows = await database
    .select()
    .from(notificationConversation)
    .where(predicate)
    .orderBy(
      notificationConversation.organizationId,
      notificationConversation.userId,
      notificationConversation.conversationKey,
    )
    .for('update');
  const byKey = new Map(
    rows.map((row) => [
      notificationConversationLookupKey(row.organizationId, row.userId, row.conversationKey),
      row,
    ]),
  );
  for (const plan of plans) {
    const row = byKey.get(
      notificationConversationLookupKey(
        plan.organizationId,
        plan.userId,
        plan.conversation.conversationKey,
      ),
    );
    if (
      row === undefined ||
      row.subjectType !== plan.conversation.subjectType ||
      row.subjectId !== plan.conversation.subjectId ||
      row.category !== plan.conversation.category
    ) {
      throw new TypeError('Notification conversation identity conflicts with existing state.');
    }
  }
  return byKey;
}

function aggregateFromRow(row: ConversationRow): ConversationAggregate {
  if (row.category !== 'activity' && row.category !== 'status') {
    throw new TypeError('Notification conversation category is invalid.');
  }
  return {
    conversationKey: row.conversationKey,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    category: row.category,
    latestEventId: row.latestEventId,
    latestType: row.latestType,
    latestActorName: row.latestActorName,
    latestTitle: row.latestTitle,
    latestBody: row.latestBody,
    latestUrl: row.latestUrl,
    latestExternalUrl: row.latestExternalUrl,
    latestOccurredAt: row.latestOccurredAt,
    eventCount: row.eventCount,
    unreadEventCount: row.unreadEventCount,
    unreadMentionCount: row.unreadMentionCount,
    manualUnread: row.manualUnread,
    lastMentionAt: row.lastMentionAt,
    readAt: row.readAt,
    snoozedUntil: row.snoozedUntil,
    dismissedAt: row.dismissedAt,
    accessHiddenAt: row.accessHiddenAt,
    snoozeGeneration: row.snoozeGeneration,
    accessGeneration: row.accessGeneration,
    lastActivitySeq: row.lastActivitySeq,
    lastActivityAt: row.lastActivityAt,
  };
}

function aggregateUpdate(aggregate: ConversationAggregate, now: Date) {
  return {
    latestEventId: aggregate.latestEventId,
    latestType: aggregate.latestType,
    latestActorName: aggregate.latestActorName,
    latestTitle: aggregate.latestTitle,
    latestBody: aggregate.latestBody,
    latestUrl: aggregate.latestUrl,
    latestExternalUrl: aggregate.latestExternalUrl,
    latestOccurredAt: aggregate.latestOccurredAt,
    eventCount: aggregate.eventCount,
    unreadEventCount: aggregate.unreadEventCount,
    unreadMentionCount: aggregate.unreadMentionCount,
    manualUnread: aggregate.manualUnread,
    lastMentionAt: aggregate.lastMentionAt,
    readAt: aggregate.readAt,
    snoozedUntil: aggregate.snoozedUntil,
    dismissedAt: aggregate.dismissedAt,
    accessHiddenAt: aggregate.accessHiddenAt,
    accessGeneration: aggregate.accessGeneration,
    snoozeGeneration: aggregate.snoozeGeneration,
    lastActivitySeq: aggregate.lastActivitySeq,
    lastActivityAt: aggregate.lastActivityAt,
    syncId: nextSyncId,
    updatedAt: now,
  };
}

function rowIsSurfaced(row: NotificationRow): boolean {
  if (row.deduplicatedIntoNotificationId !== null) return false;
  if (row.surfaceInInbox !== null) return row.surfaceInInbox;
  return row.deliveredChannels.includes('inbox');
}

function sameDate(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function newestNotification(left: NotificationRow, right: NotificationRow): number {
  const sequence = (right.ingestionSeq ?? 0) - (left.ingestionSeq ?? 0);
  if (sequence !== 0) return sequence;
  const created = right.createdAt.getTime() - left.createdAt.getTime();
  if (created !== 0) return created;
  return right.id.localeCompare(left.id);
}

function latestDate(values: readonly (Date | null)[]): Date | null {
  const dates = values.filter((value): value is Date => value !== null);
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((value) => value.getTime())));
}

function earliestDate(values: readonly Date[]): Date | null {
  if (values.length === 0) return null;
  return new Date(Math.min(...values.map((value) => value.getTime())));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: compatibility folding mirrors legacy event state into one conversation
function foldConversationRows(
  current: ConversationRow,
  rows: readonly NotificationRow[],
  now: Date,
): ConversationAggregate {
  const surfaced = rows.filter(rowIsSurfaced).sort(newestNotification);
  const active = surfaced.filter((row) => row.dismissedAt === null);
  const visibleActive = active.filter(
    (row) => row.snoozedUntil === null || row.snoozedUntil.getTime() <= now.getTime(),
  );
  const snapshot = visibleActive[0] ?? active[0] ?? surfaced[0];
  const realUnread = active.filter(
    (row) => row.readAt === null && row.manualUnreadAnchor === false,
  );
  const manualUnread = realUnread.length === 0 && active.some((row) => row.manualUnreadAnchor);
  const snoozeDates = active.flatMap((row) =>
    row.snoozedUntil !== null && row.snoozedUntil.getTime() > now.getTime()
      ? [row.snoozedUntil]
      : [],
  );
  const snoozedUntil =
    active.length > 0 && snoozeDates.length === active.length ? earliestDate(snoozeDates) : null;
  const dismissedAt =
    active.length === 0 && surfaced.length > 0
      ? latestDate(surfaced.map((row) => row.dismissedAt))
      : null;
  const visibilityChanged = !(
    sameDate(current.snoozedUntil, snoozedUntil) && sameDate(current.dismissedAt, dismissedAt)
  );
  const latestSequence = snapshot?.ingestionSeq ?? current.lastActivitySeq;
  return {
    conversationKey: current.conversationKey,
    subjectType: current.subjectType,
    subjectId: current.subjectId,
    category: current.category === 'status' ? 'status' : 'activity',
    latestEventId: snapshot?.id ?? null,
    latestType: snapshot?.type ?? null,
    latestActorName: snapshot?.actorName ?? null,
    latestTitle: snapshot?.title ?? null,
    latestBody: snapshot?.body ?? null,
    latestUrl: snapshot?.url ?? null,
    latestExternalUrl: snapshot?.externalUrl ?? null,
    latestOccurredAt: snapshot?.occurredAt ?? snapshot?.createdAt ?? null,
    eventCount: surfaced.length,
    unreadEventCount: realUnread.length,
    unreadMentionCount: realUnread.filter((row) => row.type === 'mention').length,
    manualUnread,
    lastMentionAt: latestDate(
      surfaced
        .filter((row) => row.type === 'mention')
        .map((row) => row.ingestedAt ?? row.createdAt),
    ),
    readAt:
      realUnread.length === 0 && !manualUnread
        ? (latestDate(active.map((row) => row.readAt)) ?? current.readAt)
        : current.readAt,
    snoozedUntil,
    dismissedAt,
    accessHiddenAt: current.accessHiddenAt,
    snoozeGeneration: current.snoozeGeneration + (visibilityChanged ? 1 : 0),
    accessGeneration: current.accessGeneration,
    lastActivitySeq: latestSequence,
    lastActivityAt: snapshot?.ingestedAt ?? snapshot?.createdAt ?? null,
  };
}

async function refreshInboxStates(
  database: CompatibilityDatabase,
  recipients: readonly { organizationId: string; userId: string }[],
  now: Date,
): Promise<void> {
  if (recipients.length === 0) return;
  const predicate = conversationRecipientPredicate(recipients);
  if (predicate === undefined) return;
  const rows = await database
    .select({
      organizationId: notificationConversation.organizationId,
      userId: notificationConversation.userId,
      category: notificationConversation.category,
      unreadEventCount: notificationConversation.unreadEventCount,
      unreadMentionCount: notificationConversation.unreadMentionCount,
      manualUnread: notificationConversation.manualUnread,
      snoozedUntil: notificationConversation.snoozedUntil,
      dismissedAt: notificationConversation.dismissedAt,
      accessHiddenAt: notificationConversation.accessHiddenAt,
    })
    .from(notificationConversation)
    .where(predicate);
  const counters = new Map(
    recipients.map((recipient) => [
      recipientKey(recipient.organizationId, recipient.userId),
      { unreadCount: 0, unreadActivityCount: 0, unreadMentionCount: 0 },
    ]),
  );
  for (const row of rows) {
    const unread = row.unreadEventCount > 0 || row.manualUnread;
    const visible =
      row.dismissedAt === null &&
      row.accessHiddenAt === null &&
      (row.snoozedUntil === null || row.snoozedUntil.getTime() <= now.getTime());
    if (!(unread && visible)) continue;
    const counter = counters.get(recipientKey(row.organizationId, row.userId));
    if (counter === undefined) continue;
    counter.unreadCount += 1;
    if (row.category === 'activity') counter.unreadActivityCount += 1;
    if (row.unreadMentionCount > 0) counter.unreadMentionCount += 1;
  }
  for (const recipient of recipients) {
    const counter = counters.get(recipientKey(recipient.organizationId, recipient.userId));
    if (counter === undefined) continue;
    await database
      .update(notificationInboxState)
      .set({
        unreadCount: counter.unreadCount,
        unreadActivityCount: counter.unreadActivityCount,
        unreadMentionCount: counter.unreadMentionCount,
        syncId: nextSyncId,
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationInboxState.organizationId, recipient.organizationId),
          eq(notificationInboxState.userId, recipient.userId),
        ),
      );
  }
}

async function enqueueSnoozeWake(
  database: CompatibilityDatabase,
  conversation: ConversationRow,
  aggregate: ConversationAggregate,
  now: Date,
): Promise<void> {
  if (aggregate.snoozedUntil === null) return;
  if (
    sameDate(conversation.snoozedUntil, aggregate.snoozedUntil) &&
    conversation.snoozeGeneration === aggregate.snoozeGeneration
  ) {
    return;
  }
  await database
    .insert(notificationSnoozeWake)
    .values({
      id: randomUUIDv7(now),
      organizationId: conversation.organizationId,
      userId: conversation.userId,
      conversationId: conversation.id,
      snoozeGeneration: aggregate.snoozeGeneration,
      wakeAt: aggregate.snoozedUntil,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

export async function applyLiveNotificationConversations(
  database: CompatibilityDatabase,
  rows: readonly NotificationRow[],
  plans: readonly NotificationConversationPlan[],
  conversations: ReadonlyMap<string, ConversationRow>,
  now: Date,
): Promise<void> {
  if (rows.length === 0) return;
  const plansByNotificationId = new Map(plans.map((plan) => [plan.notificationId, plan]));
  const appliedNotificationIds = new Set(rows.map((row) => row.id));
  const appliedPlans = plans.filter((plan) => appliedNotificationIds.has(plan.notificationId));
  const aggregateByConversation = new Map<string, ConversationAggregate>();
  const rowByConversation = new Map<string, ConversationRow>();
  const surfacedConversationIds = new Set<string>();
  for (const row of [...rows].sort(
    (left, right) => (left.ingestionSeq ?? 0) - (right.ingestionSeq ?? 0),
  )) {
    const plan = plansByNotificationId.get(row.id);
    if (plan === undefined || row.conversationId === null || row.ingestionSeq === null) continue;
    const key = notificationConversationLookupKey(
      plan.organizationId,
      plan.userId,
      plan.conversation.conversationKey,
    );
    const conversation = conversations.get(key);
    if (conversation === undefined) continue;
    const current = aggregateByConversation.get(conversation.id) ?? aggregateFromRow(conversation);
    const next = applyLiveConversationEvent(current, {
      id: row.id,
      type: row.type,
      actorName: row.actorName,
      title: row.title,
      body: row.body,
      url: row.url,
      externalUrl: row.externalUrl,
      occurredAt: row.occurredAt ?? row.createdAt,
      ingestedAt: row.ingestedAt ?? row.createdAt,
      ingestionSeq: row.ingestionSeq,
      surfaceInInbox: row.surfaceInInbox === true,
    });
    aggregateByConversation.set(conversation.id, next);
    rowByConversation.set(conversation.id, conversation);
    if (row.surfaceInInbox === true) surfacedConversationIds.add(conversation.id);
  }
  for (const conversationId of [...surfacedConversationIds].sort()) {
    await database
      .update(notification)
      .set({ manualUnreadAnchor: false })
      .where(
        and(
          eq(notification.conversationId, conversationId),
          isNull(notification.deduplicatedIntoNotificationId),
        ),
      );
    await database
      .update(notification)
      .set({ snoozedUntil: null })
      .where(
        and(
          eq(notification.conversationId, conversationId),
          isNull(notification.deduplicatedIntoNotificationId),
          isNull(notification.dismissedAt),
        ),
      );
  }
  for (const [conversationId, aggregate] of [...aggregateByConversation.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const previous = rowByConversation.get(conversationId);
    if (previous === undefined) continue;
    await database
      .update(notificationConversation)
      .set(aggregateUpdate(aggregate, now))
      .where(eq(notificationConversation.id, conversationId));
    await enqueueSnoozeWake(database, previous, aggregate, now);
  }
  await refreshInboxStates(database, uniqueRecipients(appliedPlans), now);
}

function mutationTargetPredicate(input: LegacyNotificationMutationInput) {
  const base = and(
    eq(notification.organizationId, input.organizationId),
    eq(notification.userId, input.userId),
    isNull(notification.deduplicatedIntoNotificationId),
  );
  if (input.kind === 'read_all') {
    return and(base, isNull(notification.readAt), isNull(notification.dismissedAt));
  }
  const ids = input.notificationIds ?? [];
  if (ids.length === 0) return and(base, eq(notification.id, ''));
  if (input.kind === 'dismiss') {
    return and(base, inArray(notification.id, [...ids]), isNull(notification.dismissedAt));
  }
  return and(base, inArray(notification.id, [...ids]));
}

function mutationValues(input: LegacyNotificationMutationInput) {
  if (input.kind === 'read' || input.kind === 'read_all') {
    return {
      readAt: input.kind === 'read' && input.read === false ? null : input.now,
      manualUnreadAnchor: false,
      syncId: nextSyncId,
    };
  }
  if (input.kind === 'snooze') {
    return { snoozedUntil: input.until ?? input.now, syncId: nextSyncId };
  }
  return { dismissedAt: input.now, syncId: nextSyncId };
}

export async function mutateLegacyNotifications(
  database: CompatibilityDatabase,
  input: LegacyNotificationMutationInput,
): Promise<NotificationRow[]> {
  const initialCandidates = await database
    .select()
    .from(notification)
    .where(mutationTargetPredicate(input))
    .orderBy(asc(notification.id));
  if (initialCandidates.length === 0) return [];
  const recipients = [{ organizationId: input.organizationId, userId: input.userId }];
  await ensureAndLockInboxStates(database, recipients, input.now);
  const candidates = await database
    .select()
    .from(notification)
    .where(mutationTargetPredicate(input))
    .orderBy(asc(notification.id));
  if (candidates.length === 0) return [];
  const conversationIds = [
    ...new Set(
      candidates.flatMap((row) => (row.conversationId === null ? [] : [row.conversationId])),
    ),
  ].sort();
  let conversations: ConversationRow[] = [];
  if (conversationIds.length > 0) {
    conversations = await database
      .select()
      .from(notificationConversation)
      .where(inArray(notificationConversation.id, conversationIds))
      .orderBy(
        asc(notificationConversation.organizationId),
        asc(notificationConversation.userId),
        asc(notificationConversation.conversationKey),
      )
      .for('update');
  }
  const legacyIds = candidates.flatMap((row) => (row.conversationId === null ? [row.id] : []));
  if (conversationIds.length > 0 || legacyIds.length > 0) {
    const siblingPredicate = or(
      conversationIds.length === 0
        ? undefined
        : inArray(notification.conversationId, conversationIds),
      legacyIds.length === 0 ? undefined : inArray(notification.id, legacyIds),
    );
    if (siblingPredicate === undefined) throw new Error('Notification lock target is missing.');
    await database
      .select({ id: notification.id })
      .from(notification)
      .where(siblingPredicate)
      .orderBy(
        asc(notification.organizationId),
        asc(notification.userId),
        asc(notification.conversationId),
        asc(notification.id),
      )
      .for('update');
  }
  const updated = await database
    .update(notification)
    .set(mutationValues(input))
    .where(mutationTargetPredicate(input))
    .returning();
  if (conversationIds.length === 0) return updated;
  const siblings = await database
    .select()
    .from(notification)
    .where(
      and(
        inArray(notification.conversationId, conversationIds),
        isNull(notification.deduplicatedIntoNotificationId),
      ),
    )
    .orderBy(
      asc(notification.organizationId),
      asc(notification.userId),
      asc(notification.conversationId),
      asc(notification.id),
    );
  for (const conversation of conversations) {
    const folded = foldConversationRows(
      conversation,
      siblings.filter((row) => row.conversationId === conversation.id),
      input.now,
    );
    await database
      .update(notificationConversation)
      .set(aggregateUpdate(folded, input.now))
      .where(eq(notificationConversation.id, conversation.id));
    await enqueueSnoozeWake(database, conversation, folded, input.now);
  }
  await refreshInboxStates(database, recipients, input.now);
  return updated;
}

export function compatibleInboxSurface() {
  return or(
    eq(notification.surfaceInInbox, true),
    and(
      isNull(notification.surfaceInInbox),
      sql`${notification.deliveredChannels} @> '["inbox"]'::jsonb`,
    ),
  );
}
