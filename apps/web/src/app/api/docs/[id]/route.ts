import { archiveDoc, deleteDoc, getDoc, isFavoriteDoc, updateDoc } from '@orbit/core';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { renderedDocHtml } from '@/lib/docs/render.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const detail = await getDoc(principal, id);
    return {
      ...detail,
      contentHtml: renderedDocHtml(detail.doc.kind, detail.doc.content),
      favorite: await isFavoriteDoc(principal, detail.doc.id),
    };
  });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const saved = await updateDoc(principal, id, body);
    await publish(saved.actions);
    return { doc: saved.doc, contentHtml: renderedDocHtml(saved.doc.kind, saved.doc.content) };
  });
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const permanent = searchParamsOf(request)['permanent'] === '1';
  return await handle(async (principal) => {
    if (permanent) {
      const removed = await deleteDoc(principal, id);
      await publish(removed.actions);
      return { id, deleted: true };
    }
    const saved = await archiveDoc(principal, id);
    await publish(saved.actions);
    return { doc: saved.doc, archived: true };
  });
}
