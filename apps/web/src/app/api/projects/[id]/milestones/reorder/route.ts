import { reorderMilestones } from '@orbit/core';
import { milestoneReorderSchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const projectId = routeId((await params).id, 'project');
    const { milestoneIds } = milestoneReorderSchema.parse(await readJson(request));
    const result = await reorderMilestones(principal, projectId, milestoneIds);
    await publish(result.actions);
    return { milestones: result.milestones };
  });
}
