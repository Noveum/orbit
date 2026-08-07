import { reorderWorkflowStates } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const result = await reorderWorkflowStates(principal, await readJson(request));
    await publish(result.actions);
    return { states: result.states };
  });
}
