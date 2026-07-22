import { revokeInvite } from '@orbit/core';
import { apiContext, handleRoute, publish } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id } = await params;
    const result = await revokeInvite(principal, id);
    await publish(result.actions);
    return { invitation: result.invitation };
  });
}
