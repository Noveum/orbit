import { createWorkflowState, listWorkflowStates } from '@orbit/core';
import { workflowStateListQuerySchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const query = workflowStateListQuerySchema.parse(searchParamsOf(request));
    return { states: await listWorkflowStates(principal, query.teamId) };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const result = await createWorkflowState(principal, await readJson(request));
    await publish(result.actions);
    return { state: result.state };
  });
}
