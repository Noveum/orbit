import { completeCycle } from '@orbit/core';
import { apiContext, handleRoute, publish, routeId } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'sprint');
    const result = await completeCycle(principal, id);
    await publish(result.actions);
    return {
      cycle: result.cycle,
      nextCycle: result.nextCycle,
      rolledOverIssueIds: result.rolledOverIssueIds,
    };
  });
}
