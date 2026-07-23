import { createComment, listComments } from '@orbit/core';
import { renderMarkdown } from '@orbit/services/markdown';
import { commentQuerySchema, paginationSchema } from '@orbit/shared/validators';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

const commentListQuerySchema = commentQuerySchema.extend(paginationSchema.shape);

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const query = commentListQuerySchema.parse(searchParamsOf(request));
    const page = await listComments(principal, query.issueId, query);
    return {
      comments: page.comments.map((row) => ({
        comment: row.comment,
        bodyHtml: renderMarkdown(row.comment.body),
        reactions: row.reactions,
      })),
      nextCursor: page.nextCursor,
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
