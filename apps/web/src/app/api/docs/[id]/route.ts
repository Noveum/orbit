import { archiveDoc, getDoc, updateDoc } from '@orbit/core';
import { renderMarkdown } from '@orbit/services/markdown';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const detail = await getDoc(principal, id);
    return { ...detail, contentHtml: renderMarkdown(detail.doc.content) };
  });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const saved = await updateDoc(principal, id, body);
    await publish(saved.actions);
    return { doc: saved.doc, contentHtml: renderMarkdown(saved.doc.content) };
  });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const saved = await archiveDoc(principal, id);
    await publish(saved.actions);
    return { doc: saved.doc, archived: true };
  });
}
