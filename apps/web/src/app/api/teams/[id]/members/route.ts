import { addTeamMember, listTeamMembers } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id } = await params;
    return { members: await listTeamMembers(principal, id) };
  });
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id } = await params;
    const result = await addTeamMember(principal, id, await readJson(request));
    await publish(result.actions);
    return { teamMember: result.teamMember };
  });
}
