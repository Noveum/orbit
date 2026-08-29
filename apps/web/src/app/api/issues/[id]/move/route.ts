import { moveIssue } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';
import { attachIssueDecorations } from '@/lib/api/issues.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await moveIssue(principal, id, body);
    await publish(result.actions);
    const [issue] = await attachIssueDecorations([result.issue]);
    return { issue, rebalanced: await attachIssueDecorations(result.rebalanced) };
  });
}
