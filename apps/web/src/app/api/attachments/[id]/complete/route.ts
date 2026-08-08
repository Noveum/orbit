import { finishUpload } from '@orbit/core';
import { handle, publish } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const result = await finishUpload(principal, id);
    await publish(result.actions);
    return { attachment: result.attachment };
  });
}
