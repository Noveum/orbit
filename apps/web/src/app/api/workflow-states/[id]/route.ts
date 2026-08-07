import { deleteWorkflowState, updateWorkflowState } from '@orbit/core';
import { workflowStateDeleteQuerySchema } from '@orbit/shared/validators';
import {
  apiContext,
  handleRoute,
  publish,
  readJson,
  routeId,
  searchParamsOf,
} from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'status');
    const result = await updateWorkflowState(principal, id, await readJson(request));
    await publish(result.actions);
    return { state: result.state };
  });
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'status');
    const query = workflowStateDeleteQuerySchema.parse(searchParamsOf(request));
    const options = query.moveToStateId === undefined ? {} : { moveToStateId: query.moveToStateId };
    await publish(await deleteWorkflowState(principal, id, options));
    return { deleted: true };
  });
}
