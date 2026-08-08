import { moveDoc } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const moved = await moveDoc(principal, id, body);
    await publish(moved.actions);
    return { doc: moved.doc, moved: moved.moved };
  });
}
