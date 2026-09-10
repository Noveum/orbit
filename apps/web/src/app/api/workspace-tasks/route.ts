import { listWorkspaceTasks } from '@orbit/core';
import { workspaceTasksQuerySchema } from '@orbit/shared/validators';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const query = workspaceTasksQuerySchema.parse(searchParamsOf(request));
    return await listWorkspaceTasks(principal, query);
  });
}
