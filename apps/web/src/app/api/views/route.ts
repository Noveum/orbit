import { createView, listViews } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';
import { toViewPayload } from '@/lib/api/views.ts';

export async function GET(): Promise<Response> {
  return await handle(async (principal) => {
    const rows = await listViews(principal);
    return { views: rows.map(toViewPayload) };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const created = await createView(principal, body);
    await publish(created.actions);
    return { view: toViewPayload(created.view) };
  });
}
