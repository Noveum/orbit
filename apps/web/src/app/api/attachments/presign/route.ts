import { registerUpload } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const registered = await registerUpload(principal, body);
    await publish(registered.actions);
    return { attachment: registered.attachment, upload: registered.upload };
  });
}
