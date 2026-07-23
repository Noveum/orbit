import { isPublishedDoc } from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import { storageDriver } from '@orbit/services/storage';
import { notFound } from '@orbit/shared/errors';
import { dispositionFor } from '@/lib/api/content-disposition.ts';
import { apiContext, errorResponse } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ key: string[] }>;
}

const DOWNLOAD_URL_TTL_SECONDS = 300;

type AttachmentRecord = typeof schema.attachment.$inferSelect;

async function assertReadable(record: AttachmentRecord | undefined): Promise<AttachmentRecord> {
  if (record === undefined) throw notFound('That file does not exist.');
  if (record.parentType === 'doc' && (await isPublishedDoc(record.parentId))) return record;
  const { principal } = await apiContext();
  if (record.organizationId !== principal.organizationId) {
    throw notFound('That file does not exist.');
  }
  return record;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { key } = await context.params;
    const storageKey = key.join('/');

    const [found] = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.storageKey, storageKey))
      .limit(1);
    const record = await assertReadable(found);

    const url = await storageDriver().getUrl(storageKey, DOWNLOAD_URL_TTL_SECONDS, {
      contentType: record.contentType,
      disposition: dispositionFor(record.contentType, record.fileName),
    });
    return Response.redirect(url, 302);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
