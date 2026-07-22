import { toggleReaction } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await toggleReaction(principal, id, body);
    await publish(result.actions);
    return { emoji: result.emoji, active: result.active };
  });
}
