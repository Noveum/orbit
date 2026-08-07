import { deleteMilestone, updateMilestone } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'milestone');
    const result = await updateMilestone(principal, id, await readJson(request));
    await publish(result.actions);
    return { milestone: result.milestone };
  });
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'milestone');
    await publish(await deleteMilestone(principal, id));
    return { deleted: true };
  });
}
