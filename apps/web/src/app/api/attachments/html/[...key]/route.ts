import { storageDriver } from '@orbit/services/storage';
import { notFound, payloadTooLarge } from '@orbit/shared/errors';
import { readableAttachment, storageKeyFrom } from '@/lib/api/attachment-access.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { htmlArtifactHeaders, isHtmlAttachment } from '@/lib/docs/html-artifact.ts';

interface RouteContext {
  readonly params: Promise<{ key: string[] }>;
}

export const MAX_HTML_PREVIEW_BYTES = 2 * 1024 * 1024;

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const storageKey = storageKeyFrom((await context.params).key);
    const { record } = await readableAttachment(storageKey);

    if (!isHtmlAttachment(record.contentType)) {
      throw notFound('That file is not an HTML page.');
    }
    if (record.size > MAX_HTML_PREVIEW_BYTES) {
      throw payloadTooLarge('That page is too large to preview. Download it instead.');
    }

    const body = await storageDriver().get(storageKey);
    if (body === null) throw notFound('That file does not exist.');
    if (body.byteLength > MAX_HTML_PREVIEW_BYTES) {
      throw payloadTooLarge('That page is too large to preview. Download it instead.');
    }

    return new Response(new TextDecoder().decode(body), { headers: htmlArtifactHeaders() });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
