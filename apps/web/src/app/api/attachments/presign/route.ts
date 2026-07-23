import { buildSyncAction, newId, nextSyncId, principalActor, requireRow } from '@orbit/core';
import { db, schema } from '@orbit/db';
import {
  assertUploadParent,
  storageDriver,
  storageKeyFor,
  validateUpload,
} from '@orbit/services/storage';
import { scopes } from '@orbit/shared/events';
import { uploadRequestSchema } from '@orbit/shared/validators';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const upload = validateUpload(body);
    const parsed = uploadRequestSchema.parse(body);
    await assertUploadParent(db, principal, parsed.parentType, parsed.parentId);

    const key = storageKeyFor(principal.organizationId, upload.safeName);
    const target = await storageDriver().createUploadTarget(key, upload.contentType);

    const syncId = await nextSyncId(db);
    const [created] = await db
      .insert(schema.attachment)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        parentType: parsed.parentType,
        parentId: parsed.parentId,
        fileName: upload.fileName,
        contentType: upload.contentType,
        size: upload.size,
        storageKey: target.key,
        uploadedById: principal.userId,
        syncId,
      })
      .returning();
    const attachment = requireRow(created, 'That upload could not be registered.');

    const scope = [scopes.organization(attachment.organizationId)];
    if (attachment.parentType === 'doc') scope.push(scopes.doc(attachment.parentId));
    if (attachment.parentType === 'issue') scope.push(scopes.issue(attachment.parentId));
    if (attachment.parentType === 'project') scope.push(scopes.project(attachment.parentId));

    await publish([
      buildSyncAction({
        syncId,
        organizationId: attachment.organizationId,
        scopes: scope,
        action: 'insert',
        model: 'attachment',
        modelId: attachment.id,
        data: attachment,
        actor: await principalActor(db, principal),
      }),
    ]);

    return { attachment, upload: target };
  });
}
