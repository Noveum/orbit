import { listRelatedIssues, type RelatedIssue, removeRelation, setRelation } from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { attachLabels } from '@/lib/api/issues.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

async function relationPayload(
  principal: Principal,
  issueId: string,
): Promise<{ relations: { id: string; type: string; issue: unknown }[] }> {
  const related: RelatedIssue[] = await listRelatedIssues(principal, issueId);
  const issues = await attachLabels(related.map((entry) => entry.issue));
  return {
    relations: related.map((entry, index) => ({
      id: entry.id,
      type: entry.type,
      issue: issues[index],
    })),
  };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => await relationPayload(principal, id));
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await setRelation(principal, id, body);
    await publish(result.actions);
    return await relationPayload(principal, id);
  });
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const actions = await removeRelation(principal, id, searchParamsOf(request));
    await publish(actions);
    return await relationPayload(principal, id);
  });
}
