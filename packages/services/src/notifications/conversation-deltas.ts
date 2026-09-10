import { and, type Database, eq, inArray, schema, type Transaction } from '@orbit/db';
import { type Actor, type SyncAction, scopes, syncActionSchema } from '@orbit/shared/events';

export async function notificationConversationActions(
  database: Database | Transaction,
  rows: readonly { readonly conversationId: string | null }[],
  actor: Actor,
  now = new Date(),
): Promise<SyncAction[]> {
  const ids = [
    ...new Set(rows.flatMap((row) => (row.conversationId === null ? [] : [row.conversationId]))),
  ];
  if (ids.length === 0) return [];
  const found = await database
    .select({ conversation: schema.notificationConversation, state: schema.notificationInboxState })
    .from(schema.notificationConversation)
    .innerJoin(
      schema.notificationInboxState,
      and(
        eq(
          schema.notificationInboxState.organizationId,
          schema.notificationConversation.organizationId,
        ),
        eq(schema.notificationInboxState.userId, schema.notificationConversation.userId),
      ),
    )
    .where(inArray(schema.notificationConversation.id, ids));
  return found.map(({ conversation, state }) =>
    syncActionSchema.parse({
      syncId: conversation.syncId,
      organizationId: conversation.organizationId,
      scopes: [scopes.user(conversation.userId)],
      action: 'update',
      model: 'notification_conversation',
      modelId: conversation.id,
      data: {
        id: conversation.id,
        syncId: conversation.syncId,
        lastActivitySeq: conversation.lastActivitySeq,
        visible:
          conversation.eventCount > 0 &&
          conversation.dismissedAt === null &&
          conversation.accessHiddenAt === null &&
          (conversation.snoozedUntil === null || conversation.snoozedUntil <= now),
        counterVersion: state.syncId,
        counters: {
          unreadCount: state.unreadCount,
          unreadActivityCount: state.unreadActivityCount,
          unreadMentionCount: state.unreadMentionCount,
        },
      },
      actor,
      at: now.toISOString(),
    }),
  );
}
