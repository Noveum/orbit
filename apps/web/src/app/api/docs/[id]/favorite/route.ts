import { setDocFavorite } from '@orbit/core';
import { handle, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return await handle(async (principal) => {
    const id = routeId((await context.params).id, 'doc');
    const saved = await setDocFavorite(principal, id, await readJson(request));
    await publish(saved.actions);
    return { docId: saved.docId, favorite: saved.favorite };
  });
}
