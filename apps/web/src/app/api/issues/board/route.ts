import { listBoardGroups } from '@orbit/core';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  const params = searchParamsOf(request);
  return await handle(async (principal) => await listBoardGroups(principal, params));
}
