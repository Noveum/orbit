import { createMilestone, listMilestonesWithProgress } from '@orbit/core';
import { milestoneCreateBodySchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const projectId = routeId((await params).id, 'project');
    const rows = await listMilestonesWithProgress(principal, projectId);
    return {
      milestones: rows.map((row) => ({
        ...row.milestone,
        scope: row.scope,
        completed: row.completed,
      })),
    };
  });
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const projectId = routeId((await params).id, 'project');
    const draft = milestoneCreateBodySchema.parse(await readJson(request));
    const result = await createMilestone(principal, { ...draft, projectId });
    await publish(result.actions);
    return { milestone: result.milestone };
  });
}
