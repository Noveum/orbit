import { buildSyncAction } from '@orbit/core';
import type { NotificationRecord } from '@orbit/services/notifications';
import type { SyncAction, SyncActionKind } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';

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
      data: {
        id: row.id,
        syncId: row.syncId,
        visible: action !== 'delete' && row.dismissedAt === null,
      },
      actor: { type: 'user', id: principal.userId, name: actorName },
    }),
  );
}
