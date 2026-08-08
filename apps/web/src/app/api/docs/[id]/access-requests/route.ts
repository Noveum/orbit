import { docGateway, listDocAccessRequests, requestDocAccess } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const gateway = new URL(request.url).searchParams.get('gateway') === '1';
  return await handle(async (principal) =>
    gateway
      ? { gateway: await docGateway(principal, id) }
      : { requests: await listDocAccessRequests(principal, id) },
  );
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const asked = await requestDocAccess(principal, id, body);
    await publish(asked.actions);
    return { request: asked.request };
  });
}
