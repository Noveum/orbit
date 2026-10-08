import { duplicateProject } from '@orbit/core';
import { handle, publish, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id: rawId } = await context.params;
  const id = routeId(rawId, 'project');
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await duplicateProject(principal, id, body);
    await publish(result.actions);
    return { project: result.project };
  });
}
