import { and, eq, inArray, schema, sql, type Transaction } from '@orbit/db';
import {
  lockNotificationSubjectAccess,
  refreshNotificationConversationAccess,
} from '@orbit/services/notifications';
import { type Actor, type SyncAction, scopes } from '@orbit/shared/events';
import { buildSyncAction } from '../realtime/publisher.ts';

export async function lockNotificationPolicyMutation(
  tx: Transaction,
  organizationId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`notification-policy:${organizationId}`}, 0))`,
  );
}

export async function synchronizeNotificationAccess(
  tx: Transaction,
  organizationId: string,
  userIds: readonly string[],
  actor: Actor,
): Promise<SyncAction[]> {
  const actions: SyncAction[] = [];
  for (const userId of [...new Set(userIds)].sort()) {
    const changed = await refreshNotificationConversationAccess(tx, organizationId, userId);
    if (changed.length === 0) continue;
    const rows = await tx
      .select()
      .from(schema.notificationConversation)
      .where(
        and(
          eq(schema.notificationConversation.organizationId, organizationId),
          inArray(schema.notificationConversation.id, changed),
        ),
      );
    const [state] = await tx
      .select()
      .from(schema.notificationInboxState)
      .where(
        and(
          eq(schema.notificationInboxState.organizationId, organizationId),
          eq(schema.notificationInboxState.userId, userId),
        ),
      );
    for (const row of rows)
      actions.push(
        buildSyncAction({
          organizationId,
          syncId: row.syncId,
          scopes: [scopes.user(userId)],
          action: 'update',
          model: 'notification_conversation',
          modelId: row.id,
          actor,
          data: {
            id: row.id,
            syncId: row.syncId,
            lastActivitySeq: row.lastActivitySeq,
            visible:
              row.accessHiddenAt === null &&
              row.dismissedAt === null &&
              (row.snoozedUntil === null || row.snoozedUntil <= new Date()),
            accessHiddenAt: row.accessHiddenAt?.toISOString() ?? null,
            accessGeneration: row.accessGeneration,
            dismissedAt: row.dismissedAt?.toISOString() ?? null,
            snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
            counters: {
              unreadCount: state?.unreadCount ?? 0,
              unreadActivityCount: state?.unreadActivityCount ?? 0,
              unreadMentionCount: state?.unreadMentionCount ?? 0,
            },
            counterVersion: state?.syncId ?? 0,
          },
        }),
      );
  }
  await tx.execute(sql`
    update notification_delivery delivery
    set status = 'unavailable', last_error = 'subject_access_revoked', claim_token = null,
      claimed_at = null, lease_expires_at = null
    where delivery.organization_id = ${organizationId}
      and delivery.status in ('pending','processing','failed') and delivery.send_started_at is null
      and delivery.deduplicated_into_delivery_id is null
      and exists (
        select 1 from notification event join notification_conversation conversation
          on conversation.id = event.conversation_id and conversation.organization_id = event.organization_id
        where event.id = delivery.notification_id and conversation.access_hidden_at is not null
      )
  `);
  return actions;
}

export async function synchronizeDocumentNotificationAccess(
  tx: Transaction,
  organizationId: string,
  docId: string,
  actor: Actor,
): Promise<SyncAction[]> {
  const recipients = await tx
    .select({ userId: schema.notificationConversation.userId })
    .from(schema.notificationConversation)
    .where(
      and(
        eq(schema.notificationConversation.organizationId, organizationId),
        eq(schema.notificationConversation.subjectType, 'doc'),
        eq(schema.notificationConversation.subjectId, docId),
      ),
    );
  const actions = await synchronizeNotificationAccess(
    tx,
    organizationId,
    recipients.map((row) => row.userId),
    actor,
  );
  const queued = await tx.execute<{
    id: string;
    teamId: string | null;
    enabled: boolean | null;
  }>(sql`
    select delivery.id, mapping.team_id as "teamId", mapping.enabled
    from notification_delivery delivery left join slack_channel_sync mapping
      on mapping.organization_id = delivery.organization_id and mapping.integration_id = delivery.integration_id
      and delivery.destination_id = mapping.integration_id || ':' || mapping.channel_id
    where delivery.organization_id = ${organizationId} and delivery.destination_kind = 'shared_channel'
      and delivery.conversation_key = ${`orbit-doc:${docId}:activity`}
      and delivery.status in ('pending','processing','failed') and delivery.send_started_at is null
    order by delivery.id
  `);
  for (const delivery of queued) {
    if (
      delivery.enabled &&
      (await lockNotificationSubjectAccess(tx, {
        organizationId,
        subjectType: 'doc',
        subjectId: docId,
        teamId: delivery.teamId,
      }))
    )
      continue;
    await tx.execute(
      sql`update notification_delivery set status = 'unavailable', last_error = 'subject_access_revoked', claim_token = null, claimed_at = null, lease_expires_at = null where id = ${delivery.id} and send_started_at is null`,
    );
  }
  return actions;
}
