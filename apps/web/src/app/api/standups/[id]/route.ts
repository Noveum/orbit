import { getStandup, updateStandup } from '@orbit/core';
import { handle, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return await handle(async (principal) => {
    const id = routeId((await context.params).id, 'standup');
    return await getStandup(principal, id);
  });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return await handle(async (principal) => {
    const id = routeId((await context.params).id, 'standup');
    const body = await readJson(request);
    const result = await updateStandup(principal, id, body);
    await publish(result.actions);
    return result.detail;
  });
}
