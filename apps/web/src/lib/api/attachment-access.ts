import { db, eq, schema } from '@orbit/db';
import { assertAttachmentVisible, isPubliclyReadable } from '@orbit/services/storage';
import { notFound } from '@orbit/shared/errors';
import { storageKeySchema } from '@orbit/shared/validators';
import { apiContext } from './handler.ts';

type AttachmentRecord = typeof schema.attachment.$inferSelect;

export function storageKeyFrom(segments: readonly string[]): string {
  const parsed = storageKeySchema.safeParse(segments);
  if (!parsed.success) throw notFound('That file does not exist.');
  return parsed.data.join('/');
}

export async function readableAttachment(
  storageKey: string,
): Promise<{ record: AttachmentRecord; shared: boolean }> {
  const [found] = await db
    .select()
    .from(schema.attachment)
    .where(eq(schema.attachment.storageKey, storageKey))
    .limit(1);
  if (found === undefined) throw notFound('That file does not exist.');
  if (await isPubliclyReadable(db, found)) return { record: found, shared: true };
  const { principal } = await apiContext();
  await assertAttachmentVisible(db, principal, found);
  return { record: found, shared: false };
}
