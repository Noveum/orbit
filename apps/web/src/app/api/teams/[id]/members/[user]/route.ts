import { removeTeamMember } from '@orbit/core';
import { apiContext, handleRoute, publish } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string; user: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id, user } = await params;
    await publish(await removeTeamMember(principal, id, user));
    return { ok: true };
  });
}
