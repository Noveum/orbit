import { and, db, eq, schema } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { principalActor } from '../activity/activity-service.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type AttachmentRecord = typeof schema.attachment.$inferSelect;

export function attachmentScopes(
  row: Pick<AttachmentRecord, 'parentType' | 'parentId' | 'uploadedById'>,
): string[] {
  if (row.parentType === 'doc') return [scopes.doc(row.parentId)];
  if (row.parentType === 'issue') return [scopes.issue(row.parentId)];
  return [scopes.user(row.uploadedById)];
}

export interface CompletedAttachment {
  readonly attachment: AttachmentRecord;
  readonly actions: SyncAction[];
}

export async function findAttachmentForOrganization(
  principal: Principal,
  id: string,
): Promise<AttachmentRecord> {
  const [record] = await db
    .select()
    .from(schema.attachment)
    .where(
      and(
        eq(schema.attachment.id, id),
        eq(schema.attachment.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  if (record === undefined) throw notFound('That upload was not registered.');
  return record;
}

export async function markAttachmentReady(
  principal: Principal,
  record: AttachmentRecord,
  storedSize: number,
): Promise<CompletedAttachment> {
  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const [updated] = await tx
      .update(schema.attachment)
      .set({ status: 'ready', size: storedSize, syncId })
      .where(eq(schema.attachment.id, record.id))
      .returning();
    if (updated === undefined) throw notFound('That upload was not registered.');

    const actor = await principalActor(tx, principal);
    const scope = attachmentScopes(updated);

    return {
      attachment: updated,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: updated.organizationId,
          scopes: scope,
          action: 'update',
          model: 'attachment',
          modelId: updated.id,
          data: updated,
          actor,
        }),
      ],
    };
  });
}
