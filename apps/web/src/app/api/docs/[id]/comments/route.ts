import { createDocComment, listDocComments } from '@orbit/core';
import { renderMarkdown } from '@orbit/services/markdown';
import { paginationSchema } from '@orbit/shared/validators';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const query = paginationSchema.parse(searchParamsOf(request));
    const page = await listDocComments(principal, id, query);
    return {
      comments: page.comments.map((comment) => ({
        comment,
        bodyHtml: renderMarkdown(comment.body),
      })),
      nextCursor: page.nextCursor,
    };
  });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const created = await createDocComment(principal, id, body);
    await publish(created.actions);
    return {
      comment: {
        comment: created.comment,
        bodyHtml: renderMarkdown(created.comment.body),
      },
    };
  });
}
