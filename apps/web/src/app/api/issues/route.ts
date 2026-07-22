import { createIssue, listIssues } from '@orbit/core';
import { issueFilterSchema, paginationSchema } from '@orbit/shared/validators';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { attachLabels } from '@/lib/api/issues.ts';

const listSchema = issueFilterSchema.extend(paginationSchema.shape);

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const filter = listSchema.parse(searchParamsOf(request));
    const page = await listIssues(principal, filter);
    return { issues: await attachLabels(page.issues), nextCursor: page.nextCursor };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const created = await createIssue(principal, body);
    await publish(created.actions);
    const [issue] = await attachLabels([created.issue]);
    return { issue };
  });
}
