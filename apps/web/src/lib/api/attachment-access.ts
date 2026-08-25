import { db, eq, schema } from '@orbit/db';
import { assertAttachmentVisible, isPubliclyReadable } from '@orbit/services/storage';
import { notFound } from '@orbit/shared/errors';
import { z } from 'zod';
import { apiContext } from './handler.ts';

export type AttachmentRecord = typeof schema.attachment.$inferSelect;

const storageKeySchema = z
  .array(
    z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._-]+$/, 'A storage key segment may only contain safe characters.'),
  )
  .min(1)
  .max(8);

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
