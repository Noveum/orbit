import { subscribe, unsubscribe } from '@orbit/core';
import { issueSubscribeSchema } from '@orbit/shared/validators';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const input = issueSubscribeSchema.parse(body);
    const result = input.subscribed
      ? await subscribe(principal, id)
      : await unsubscribe(principal, id);
    await publish(result.actions);
    return { subscribed: result.subscribed };
  });
}
