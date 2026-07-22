import { archiveTeam, updateTeam } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id } = await params;
    const result = await updateTeam(principal, id, await readJson(request));
    await publish(result.actions);
    return { team: result.team };
  });
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id } = await params;
    const result = await archiveTeam(principal, id);
    await publish(result.actions);
    return { team: result.team };
  });
}
