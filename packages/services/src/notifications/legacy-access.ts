import { and, eq, inArray, isNull, schema, sql, type Transaction } from '@orbit/db';
import { notificationSubjectAccessMap } from './conversation-access.ts';

export async function readableLegacyNotificationIds(
  tx: Transaction,
  organizationId: string,
  userId: string,
  notificationIds?: readonly string[],
): Promise<string[]> {
  if (notificationIds?.length === 0) return [];
  const rows = await tx
    .select({
      id: schema.notification.id,
      subjectType: schema.notificationConversation.subjectType,
      subjectId: schema.notificationConversation.subjectId,
    })
    .from(schema.notification)
    .leftJoin(
      schema.notificationConversation,
      and(
        eq(schema.notificationConversation.id, schema.notification.conversationId),
        eq(schema.notificationConversation.organizationId, schema.notification.organizationId),
        eq(schema.notificationConversation.userId, schema.notification.userId),
      ),
    )
    .where(
      and(
        eq(schema.notification.organizationId, organizationId),
        eq(schema.notification.userId, userId),
        isNull(schema.notification.deduplicatedIntoNotificationId),
        notificationIds === undefined
          ? undefined
          : inArray(schema.notification.id, [...notificationIds]),
      ),
    );
  const accessible = await notificationSubjectAccessMap(
    tx,
    organizationId,
    userId,
    rows.map((row) => ({
      id: row.id,
      subjectType: row.subjectType ?? 'legacy_notification',
      subjectId: row.subjectId ?? row.id,
    })),
  );
  return rows.filter((row) => accessible.get(row.id) === true).map((row) => row.id);
}

export function readableLegacyNotificationPredicate(ids: readonly string[]) {
  return sql`${schema.notification.id} in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
}
