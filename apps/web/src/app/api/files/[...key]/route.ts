import { db, eq, schema } from '@orbit/db';
import {
  assertAttachmentVisible,
  isPubliclyReadable,
  storageDriver,
} from '@orbit/services/storage';
import { notFound } from '@orbit/shared/errors';
import { z } from 'zod';
import { dispositionFor } from '@/lib/api/content-disposition.ts';
import { apiContext, errorResponse } from '@/lib/api/handler.ts';

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

interface RouteContext {
  readonly params: Promise<{ key: string[] }>;
}

const DOWNLOAD_URL_TTL_SECONDS = 300;
const PUBLIC_REDIRECT_CACHE_SECONDS = 280;

type AttachmentRecord = typeof schema.attachment.$inferSelect;

async function assertReadable(
  record: AttachmentRecord | undefined,
): Promise<{ record: AttachmentRecord; shared: boolean }> {
  if (record === undefined) throw notFound('That file does not exist.');
  if (await isPubliclyReadable(db, record)) return { record, shared: true };
  const { principal } = await apiContext();
  await assertAttachmentVisible(db, principal, record);
  return { record, shared: false };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const parsed = storageKeySchema.safeParse((await context.params).key);
    if (!parsed.success) throw notFound('That file does not exist.');
    const storageKey = parsed.data.join('/');

    const [found] = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.storageKey, storageKey))
      .limit(1);
    const { record, shared } = await assertReadable(found);

    const url = await storageDriver().getUrl(storageKey, DOWNLOAD_URL_TTL_SECONDS, {
      contentType: record.contentType,
      disposition: dispositionFor(record.contentType, record.fileName),
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: url,
        'cache-control': shared
          ? `private, max-age=${PUBLIC_REDIRECT_CACHE_SECONDS}`
          : 'private, no-store',
      },
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
