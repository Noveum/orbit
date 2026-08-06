import { archiveProject, deleteProject, getProject, updateProject } from '@orbit/core';
import { z } from 'zod';
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

const removalSchema = z.object({ mode: z.enum(['archive', 'delete']) });

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'project');
    return { project: await getProject(principal, id) };
  });
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'project');
    const result = await updateProject(principal, id, await readJson(request));
    await publish(result.actions);
    return { project: result.project };
  });
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'project');
    const { mode } = removalSchema.parse(searchParamsOf(request));
    if (mode === 'archive') {
      const archived = await archiveProject(principal, id);
      await publish(archived.actions);
      return { archived: true };
    }
    await publish(await deleteProject(principal, id));
    return { deleted: true };
  });
}
