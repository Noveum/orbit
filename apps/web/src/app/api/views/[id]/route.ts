import { deleteView, updateView } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';
import { toViewPayload } from '@/lib/api/views.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const updated = await updateView(principal, id, body);
    await publish(updated.actions);
    return { view: toViewPayload(updated.view) };
  });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    await publish(await deleteView(principal, id));
    return { deleted: true };
  });
}
