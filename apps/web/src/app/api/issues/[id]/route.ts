import {
  deleteIssue,
  describeActivity,
  getIssue,
  listActivityPage,
  listIssues,
  listSubscribers,
  updateIssue,
} from '@orbit/core';
import { db } from '@orbit/db';
import { renderMarkdown } from '@orbit/services/markdown';
import { paginationSchema } from '@orbit/shared/validators';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { attachLabels } from '@/lib/api/issues.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

const ACTIVITY_LIMIT = 50;
const SUB_ISSUE_LIMIT = 50;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const query = paginationSchema.parse(searchParamsOf(request));
  return await handle(async (principal) => {
    const row = await getIssue(principal, id);
    const [issue] = await attachLabels([row]);
    const [activityPage, subPage, subscribers] = await Promise.all([
      listActivityPage(db, principal, row.id, {
        oldestFirst: true,
        limit: ACTIVITY_LIMIT,
        cursor: query.cursor,
      }),
      listIssues(principal, { parentId: row.id, limit: SUB_ISSUE_LIMIT }),
      listSubscribers(principal, row.id),
    ]);
    return {
      issue,
      descriptionHtml: renderMarkdown(row.description),
      activity: activityPage.activity.map((entry) => ({
        ...entry,
        summary: describeActivity(entry),
      })),
      activityCursor: activityPage.nextCursor,
      subIssues: await attachLabels(subPage.issues),
      subscribed: subscribers.some((row) => row.userId === principal.userId),
    };
  });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await updateIssue(principal, id, body);
    await publish(result.actions);
    const [issue] = await attachLabels([result.issue]);
    return { issue };
  });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const actions = await deleteIssue(principal, id);
    await publish(actions);
    return { deleted: true };
  });
}
