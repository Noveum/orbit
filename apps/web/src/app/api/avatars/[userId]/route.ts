import { avatarStorageKey, isAvatarUrl } from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import { storageDriver } from '@orbit/services/storage';
import { notFound, unauthorized } from '@orbit/shared/errors';
import { errorResponse } from '@/lib/api/handler.ts';
import { getSession } from '@/lib/auth/session.ts';

interface RouteContext {
  readonly params: Promise<{ userId: string }>;
}

const DOWNLOAD_URL_TTL_SECONDS = 300;
const REDIRECT_CACHE_SECONDS = 60;

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await getSession();
    if (session === null) throw unauthorized();

    const { userId } = await context.params;
    const [row] = await db
      .select({ image: schema.user.image })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (row === undefined || !isAvatarUrl(row.image)) throw notFound('That photo does not exist.');

    const url = await storageDriver().getUrl(avatarStorageKey(userId), DOWNLOAD_URL_TTL_SECONDS);
    return new Response(null, {
      status: 302,
      headers: {
        location: url,
        'cache-control': `private, max-age=${REDIRECT_CACHE_SECONDS}`,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
