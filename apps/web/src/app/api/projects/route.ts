import { createProject, listProjects } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    return { projects: await listProjects(principal, searchParamsOf(request)) };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const result = await createProject(principal, await readJson(request));
    await publish(result.actions);
    return { project: result.project };
  });
}
