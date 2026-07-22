import {
  deleteIssue,
  describeActivity,
  getIssue,
  listActivity,
  listIssues,
  listSubscribers,
  updateIssue,
} from '@orbit/core';
import { db } from '@orbit/db';
import { renderMarkdown } from '@orbit/services/markdown';
import { handle, publish, readJson } from '@/lib/api/handler.ts';
import { attachLabels } from '@/lib/api/issues.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const row = await getIssue(principal, id);
    const [issue] = await attachLabels([row]);
    const [activity, subPage, subscribers] = await Promise.all([
      listActivity(db, principal, row.id, { oldestFirst: true, limit: 200 }),
      listIssues(principal, { parentId: row.id, limit: 100 }),
      listSubscribers(principal, row.id),
    ]);
    return {
      issue,
      descriptionHtml: renderMarkdown(row.description),
      activity: activity.map((entry) => ({ ...entry, summary: describeActivity(entry) })),
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
