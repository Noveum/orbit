import { setViewFavorite } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';
import { toViewPayload } from '@/lib/api/views.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await setViewFavorite(principal, id, body);
    await publish(result.actions);
    return { view: toViewPayload(result.view) };
  });
}
