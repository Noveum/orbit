import { deleteCycle, getCycle, updateCycle } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'sprint');
    return { cycle: await getCycle(principal, id) };
  });
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'sprint');
    const result = await updateCycle(principal, id, await readJson(request));
    await publish(result.actions);
    return { cycle: result.cycle };
  });
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'sprint');
    await publish(await deleteCycle(principal, id));
    return { deleted: true };
  });
}
