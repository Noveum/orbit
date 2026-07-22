import { createComment, listComments } from '@orbit/core';
import { renderMarkdown } from '@orbit/services/markdown';
import { idSchema } from '@orbit/shared/validators';
import { z } from 'zod';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

const listQuerySchema = z.object({ issueId: idSchema });
const createQuerySchema = z.object({ issueId: idSchema });

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const { issueId } = listQuerySchema.parse(searchParamsOf(request));
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
    const { issueId } = createQuerySchema.parse(searchParamsOf(request));
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
