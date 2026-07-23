import { catchUp } from '@orbit/core';
import { syncCatchupQuerySchema } from '@orbit/shared/events';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const query = syncCatchupQuerySchema.parse(searchParamsOf(request));
    return await catchUp(principal, query.since);
  });
}
