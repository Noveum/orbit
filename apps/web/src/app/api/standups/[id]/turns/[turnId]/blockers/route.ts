import { addBlocker } from '@orbit/core';
import { handle, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string; turnId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return await handle(async (principal) => {
    const { id: rawId, turnId: rawTurnId } = await context.params;
    const id = routeId(rawId, 'standup');
    const turnId = routeId(rawTurnId, 'turn');
    const body = await readJson(request);
    const result = await addBlocker(principal, id, turnId, body);
    await publish(result.actions);
    return result.detail;
  });
}
