import { subscribe, unsubscribe } from '@orbit/core';
import { z } from 'zod';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

const subscribeSchema = z.object({ subscribed: z.boolean().default(true) });

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const input = subscribeSchema.parse(body);
    const result = input.subscribed
      ? await subscribe(principal, id)
      : await unsubscribe(principal, id);
    await publish(result.actions);
    return { subscribed: result.subscribed };
  });
}
