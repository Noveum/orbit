import { startStandup } from '@orbit/core';
import { handle, publish, routeId } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  return await handle(async (principal) => {
    const id = routeId((await context.params).id, 'standup');
    const result = await startStandup(principal, id);
    await publish(result.actions);
    return result.detail;
  });
}
