import { removeMember, updateMemberRole } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id } = await params;
    const result = await updateMemberRole(principal, id, await readJson(request));
    await publish(result.actions);
    return { member: result.member };
  });
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id } = await params;
    const result = await removeMember(principal, id);
    await publish(result.actions);
    return { reassignedIssueIds: result.reassignedIssueIds };
  });
}
