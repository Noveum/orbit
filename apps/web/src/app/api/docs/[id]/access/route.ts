import { listDocAccess, setDocAccess } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'doc');
    return { grants: await listDocAccess(principal, id) };
  });
}

export async function PUT(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'doc');
    const result = await setDocAccess(principal, id, await readJson(request));
    await publish(result.actions);
    return { grants: result.grants };
  });
}
