import { createCheckpoint, toSavedAnalyticsViewPayload } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const created = await createCheckpoint(principal, body);
    await publish(created.actions);
    return { checkpoint: toSavedAnalyticsViewPayload(created.view) };
  });
}
