import { storageDriver } from '@orbit/services/storage';
import { notFound, payloadTooLarge } from '@orbit/shared/errors';
import { readableAttachment, storageKeyFrom } from '@/lib/api/attachment-access.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import {
  htmlAttachmentHeaders,
  isHtmlAttachment,
  MAX_HTML_PREVIEW_BYTES,
} from '@/lib/docs/html-artifact.ts';

interface RouteContext {
  readonly params: Promise<{ key: string[] }>;
}

const TOO_LARGE = 'That page is too large to preview. Download it instead.';

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const storageKey = storageKeyFrom((await context.params).key);
    const { record } = await readableAttachment(storageKey);

    if (record.status !== 'ready') throw notFound('That file does not exist.');
    if (!isHtmlAttachment(record.contentType)) {
      throw notFound('That file is not an HTML page.');
    }
    if (record.size > MAX_HTML_PREVIEW_BYTES) throw payloadTooLarge(TOO_LARGE);

    const body = await storageDriver().get(storageKey);
    if (body === null) throw notFound('That file does not exist.');
    if (body.byteLength > MAX_HTML_PREVIEW_BYTES) throw payloadTooLarge(TOO_LARGE);

    return new Response(new Uint8Array(body), {
      headers: htmlAttachmentHeaders(record.contentType),
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
