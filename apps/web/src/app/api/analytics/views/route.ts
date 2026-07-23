import {
  createSavedAnalyticsView,
  listSavedAnalyticsViews,
  toSavedAnalyticsViewPayload,
} from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handle(async (principal) => {
    const rows = await listSavedAnalyticsViews(principal);
    return { views: rows.map(toSavedAnalyticsViewPayload) };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const created = await createSavedAnalyticsView(principal, body);
    await publish(created.actions);
    return { view: toSavedAnalyticsViewPayload(created.view) };
  });
}
