import { storageDriver } from '@orbit/services/storage';
import { readableAttachment, storageKeyFrom } from '@/lib/api/attachment-access.ts';
import { dispositionFor } from '@/lib/api/content-disposition.ts';
import { errorResponse } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ key: string[] }>;
}

const DOWNLOAD_URL_TTL_SECONDS = 300;
const PUBLIC_REDIRECT_CACHE_SECONDS = 280;

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const storageKey = storageKeyFrom((await context.params).key);
    const { record, shared } = await readableAttachment(storageKey);

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
