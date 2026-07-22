import { createComment, listComments } from '@orbit/core';
import { renderMarkdown } from '@orbit/services/markdown';
import { commentQuerySchema } from '@orbit/shared/validators';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const { issueId } = commentQuerySchema.parse(searchParamsOf(request));
    const rows = await listComments(principal, issueId);
    return {
      comments: rows.map((row) => ({
        comment: row.comment,
        bodyHtml: renderMarkdown(row.comment.body),
        reactions: row.reactions,
      })),
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const { issueId } = commentQuerySchema.parse(searchParamsOf(request));
    const created = await createComment(principal, issueId, body);
    await publish(created.actions);
    return {
      comment: {
        comment: created.comment,
        bodyHtml: renderMarkdown(created.comment.body),
        reactions: [],
      },
    };
  });
}
