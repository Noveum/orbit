import { createDoc } from '@orbit/core';
import { docListPayload } from '@/lib/api/docs.ts';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => docListPayload(principal, searchParamsOf(request)));
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const created = await createDoc(principal, body);
    await publish(created.actions);
    return { doc: created.doc };
  });
}
