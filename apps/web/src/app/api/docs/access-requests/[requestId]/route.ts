import { decideDocAccessRequest } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ requestId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { requestId } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const decided = await decideDocAccessRequest(principal, requestId, body);
    await publish(decided.actions);
    return { request: decided.request };
  });
}
