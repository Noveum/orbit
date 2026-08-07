import { createMilestone, listMilestones } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const projectId = routeId((await params).id, 'project');
    return { milestones: await listMilestones(principal, projectId) };
  });
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const projectId = routeId((await params).id, 'project');
    const body = await readJson(request);
    const input = typeof body === 'object' && body !== null ? body : {};
    const result = await createMilestone(principal, { ...input, projectId });
    await publish(result.actions);
    return { milestone: result.milestone };
  });
}
