import { markAsDuplicate } from '@orbit/core';
import { issueMarkDuplicateSchema } from '@orbit/shared';
import { handle, publish, readJson } from '@/lib/api/handler.ts';
import { attachIssueDecorations } from '@/lib/api/issues.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const input = issueMarkDuplicateSchema.parse(await readJson(request));
  return await handle(async (principal) => {
    const result = await markAsDuplicate(principal, id, input);
    await publish(result.actions);
    const [decorated] = await attachIssueDecorations([result.issue]);
    return { issue: decorated };
  });
}
