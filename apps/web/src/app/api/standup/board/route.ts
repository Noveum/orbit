import { standupBoard } from '@orbit/core';
import { standupBoardQuerySchema } from '@orbit/shared/validators';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';
import { attachLabels } from '@/lib/api/issues.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const query = standupBoardQuerySchema.parse(searchParamsOf(request));
    const board = await standupBoard(principal, query);
    return {
      since: board.since.toISOString(),
      issues: await attachLabels(board.issues),
      workload: board.workload,
    };
  });
}
