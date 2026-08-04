import { focusTurn } from '@orbit/core';
import { handle, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return await handle(async (principal) => {
    const id = routeId((await context.params).id, 'standup');
    const body = await readJson(request);
    const result = await focusTurn(principal, id, body);
    await publish(result.actions);
    return result.detail;
  });
}
