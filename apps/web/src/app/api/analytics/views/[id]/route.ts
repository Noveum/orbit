import {
  deleteSavedAnalyticsView,
  toSavedAnalyticsViewPayload,
  updateSavedAnalyticsView,
} from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const updated = await updateSavedAnalyticsView(principal, id, body);
    await publish(updated.actions);
    return { view: toSavedAnalyticsViewPayload(updated.view) };
  });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    await publish(await deleteSavedAnalyticsView(principal, id));
    return { deleted: true };
  });
}
