import { createDocCollection, listDocCollections } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handle(async (principal) => ({
    collections: await listDocCollections(principal),
  }));
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const created = await createDocCollection(principal, body);
    await publish(created.actions);
    return { collection: created.collection };
  });
}
