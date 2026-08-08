import { restoreTeam } from '@orbit/core';
import { apiContext, handleRoute, publish } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id } = await params;
    const result = await restoreTeam(principal, id);
    await publish(result.actions);
    return { team: result.team };
  });
}
