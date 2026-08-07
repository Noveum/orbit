import { deleteLabel, getLabel, updateLabel } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'label');
    return { label: await getLabel(principal, id) };
  });
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'label');
    const result = await updateLabel(principal, id, await readJson(request));
    await publish(result.actions);
    return { label: result.label };
  });
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'label');
    await publish(await deleteLabel(principal, id));
    return { deleted: true };
  });
}
