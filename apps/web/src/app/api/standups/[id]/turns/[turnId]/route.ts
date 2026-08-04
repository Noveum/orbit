import { updateTurn } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string; turnId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id, turnId } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await updateTurn(principal, id, turnId, body);
    await publish(result.actions);
    return result.detail;
  });
}
