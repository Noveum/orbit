import { standupBoard } from '@orbit/core';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';
import { attachLabels } from '@/lib/api/issues.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const board = await standupBoard(principal, searchParamsOf(request));
    return {
      since: board.since.toISOString(),
      issues: await attachLabels(board.issues),
      workload: board.workload,
    };
  });
}
