import { listWorkspaceTasks } from '@orbit/core';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(
    async (principal) => await listWorkspaceTasks(principal, searchParamsOf(request)),
  );
}
