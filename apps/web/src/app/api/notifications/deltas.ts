import { buildSyncAction } from '@orbit/core';
import type { NotificationRecord } from '@orbit/services/notifications';
import type { SyncAction, SyncActionKind } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';

function toData(row: NotificationRecord): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    type: row.type,
    actorType: row.actorType,
    actorId: row.actorId,
    actorName: row.actorName,
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    body: row.body,
    url: row.url,
    readAt: row.readAt?.toISOString() ?? null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    deliveredChannels: row.deliveredChannels,
    syncId: row.syncId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function notificationActions(
  principal: Principal,
  actorName: string,
  action: SyncActionKind,
  rows: readonly NotificationRecord[],
): SyncAction[] {
  return rows.map((row) =>
    buildSyncAction({
      syncId: row.syncId,
      organizationId: row.organizationId,
      scopes: [scopes.user(row.userId)],
      action,
      model: 'notification',
      modelId: row.id,
      data: toData(row),
      actor: { type: 'user', id: principal.userId, name: actorName },
    }),
  );
}
