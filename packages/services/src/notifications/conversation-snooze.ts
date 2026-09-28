import { and, type Database, eq, isNull, schema, sql, type Transaction } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { ensureAndLockInboxStates, refreshInboxStates } from './compatibility.ts';
import { lockNotificationSubjectAccess } from './conversation-access.ts';

export interface NotificationSnoozeWakeChange {
  readonly organizationId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly syncId: number;
}

interface ClaimedWake extends Record<string, unknown> {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly snoozeGeneration: number;
  readonly wakeAt: Date | string;
}

type Conversation = typeof schema.notificationConversation.$inferSelect;

function isCurrentWake(
  conversation: Conversation | undefined,
  row: ClaimedWake,
): conversation is Conversation {
  return (
    conversation !== undefined &&
    conversation.snoozeGeneration === row.snoozeGeneration &&
    conversation.dismissedAt === null &&
    conversation.snoozedUntil !== null &&
    conversation.snoozedUntil.getTime() === new Date(row.wakeAt).getTime()
  );
}

export async function wakeDueNotificationConversations(
  database: Database,
  options: { readonly limit?: number; readonly now?: Date; readonly clock?: () => Date } = {},
): Promise<{
  readonly woken: number;
  readonly stale: number;
  readonly changes: readonly NotificationSnoozeWakeChange[];
}> {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new RangeError('Snooze wake limit must be between 1 and 500.');
  const clock = options.clock ?? (() => options.now ?? new Date());
  const claimedAt = options.now ?? clock();
  const token = randomUUIDv7();
  const rows = await database.transaction(
    async (tx) =>
      await tx.execute<ClaimedWake>(sql`
    update notification_snooze_wake wake
    set status = 'processing', claim_token = ${token}, claimed_at = ${claimedAt.toISOString()},
      lease_expires_at = ${new Date(claimedAt.getTime() + 60_000).toISOString()}, attempts = attempts + 1,
      updated_at = ${claimedAt.toISOString()}
    where id in (
      select id from notification_snooze_wake
      where wake_at <= ${claimedAt.toISOString()} and (
        status in ('pending', 'failed') or (status = 'processing' and lease_expires_at <= ${claimedAt.toISOString()})
      )
      order by wake_at, id limit ${limit} for update skip locked
    )
    returning id, organization_id as "organizationId", user_id as "userId",
      conversation_id as "conversationId", snooze_generation::float8 as "snoozeGeneration", wake_at as "wakeAt"
  `),
  );
  const changes: NotificationSnoozeWakeChange[] = [];
  let stale = 0;
  for (const row of rows) {
    const result = await database.transaction(
      async (tx) => await finishWake(tx, row, token, clock),
    );
    if (result === null) stale += 1;
    else changes.push(result);
  }
  return { woken: changes.length, stale, changes };
}

async function finishWake(
  tx: Transaction,
  row: ClaimedWake,
  token: string,
  clock: () => Date,
): Promise<NotificationSnoozeWakeChange | null> {
  const [subject] = await tx
    .select({
      subjectType: schema.notificationConversation.subjectType,
      subjectId: schema.notificationConversation.subjectId,
    })
    .from(schema.notificationConversation)
    .where(eq(schema.notificationConversation.id, row.conversationId));
  const accessible =
    subject !== undefined &&
    (await lockNotificationSubjectAccess(tx, {
      organizationId: row.organizationId,
      userId: row.userId,
      ...subject,
    }));
  await ensureAndLockInboxStates(
    tx,
    [{ organizationId: row.organizationId, userId: row.userId }],
    clock(),
  );
  const [conversation] = await tx
    .select()
    .from(schema.notificationConversation)
    .where(
      and(
        eq(schema.notificationConversation.id, row.conversationId),
        eq(schema.notificationConversation.organizationId, row.organizationId),
        eq(schema.notificationConversation.userId, row.userId),
      ),
    )
    .for('update');
  await tx
    .select({ id: schema.notification.id })
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.conversationId, row.conversationId),
        eq(schema.notification.organizationId, row.organizationId),
        eq(schema.notification.userId, row.userId),
        isNull(schema.notification.deduplicatedIntoNotificationId),
      ),
    )
    .orderBy(schema.notification.id)
    .for('update');
  const [claim] = await tx
    .select()
    .from(schema.notificationSnoozeWake)
    .where(
      and(
        eq(schema.notificationSnoozeWake.id, row.id),
        eq(schema.notificationSnoozeWake.status, 'processing'),
        eq(schema.notificationSnoozeWake.claimToken, token),
      ),
    )
    .for('update');
  const now = clock();
  if (claim?.leaseExpiresAt === null || claim?.leaseExpiresAt === undefined) return null;
  if (claim.leaseExpiresAt.getTime() <= now.getTime()) return null;
  const current = isCurrentWake(conversation, row);
  let change: NotificationSnoozeWakeChange | null = null;
  if (current) {
    const [updated] = await tx
      .update(schema.notificationConversation)
      .set({
        snoozedUntil: null,
        accessHiddenAt: accessible ? null : now,
        accessGeneration: sql`${schema.notificationConversation.accessGeneration} + ${accessible === (conversation.accessHiddenAt === null) ? 0 : 1}`,
        snoozeGeneration: sql`${schema.notificationConversation.snoozeGeneration} + 1`,
        syncId: sql`nextval('sync_id_seq')`,
        updatedAt: now,
      })
      .where(eq(schema.notificationConversation.id, row.conversationId))
      .returning({ syncId: schema.notificationConversation.syncId });
    await tx
      .update(schema.notification)
      .set({ snoozedUntil: null, syncId: sql`nextval('sync_id_seq')` })
      .where(
        and(
          eq(schema.notification.conversationId, row.conversationId),
          eq(schema.notification.organizationId, row.organizationId),
          eq(schema.notification.userId, row.userId),
          isNull(schema.notification.deduplicatedIntoNotificationId),
          isNull(schema.notification.dismissedAt),
        ),
      );
    await refreshInboxStates(tx, [{ organizationId: row.organizationId, userId: row.userId }], now);
    if (updated !== undefined)
      change = {
        organizationId: row.organizationId,
        userId: row.userId,
        conversationId: row.conversationId,
        syncId: updated.syncId,
      };
  }
  await tx
    .update(schema.notificationSnoozeWake)
    .set({
      status: current ? 'completed' : 'unavailable',
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      completedAt: now,
      updatedAt: now,
      lastError: current ? null : 'Snooze generation is no longer current.',
    })
    .where(
      and(
        eq(schema.notificationSnoozeWake.id, row.id),
        eq(schema.notificationSnoozeWake.claimToken, token),
      ),
    );
  return change;
}
