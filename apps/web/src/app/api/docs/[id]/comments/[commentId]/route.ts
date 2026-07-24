import { deleteDocComment, updateDocComment } from '@orbit/core';
import { renderMarkdown } from '@orbit/services/markdown';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string; commentId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { commentId } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await updateDocComment(principal, commentId, body);
    await publish(result.actions);
    return {
      comment: {
        comment: result.comment,
        bodyHtml: renderMarkdown(result.comment.body),
      },
    };
  });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { commentId } = await context.params;
  return await handle(async (principal) => {
    const actions = await deleteDocComment(principal, commentId);
    await publish(actions);
    return { deleted: true };
  });
}
