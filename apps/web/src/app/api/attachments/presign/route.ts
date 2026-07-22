import { newId } from '@orbit/core';
import { db, schema } from '@orbit/db';
import { createStorageDriver, storageKeyFor, validateUpload } from '@orbit/services/storage';
import { assertCan } from '@orbit/shared/policy';
import { uploadRequestSchema } from '@orbit/shared/validators';
import { handle, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    assertCan(principal, 'attachment:upload');
    const parsed = uploadRequestSchema.parse(body);
    const upload = validateUpload({
      fileName: parsed.fileName,
      contentType: parsed.contentType,
      size: parsed.size,
    });

    const driver = createStorageDriver();
    const key = storageKeyFor(principal.organizationId, upload.safeName);
    const target = await driver.createUploadTarget(key, upload.contentType, upload.size);

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
      })
      .returning();

    return { attachment: created, upload: target };
  });
}
