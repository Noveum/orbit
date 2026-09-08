import { markInboxConversationsRead } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const { actions, ...result } = await markInboxConversationsRead(
      principal,
      await readJson(request),
    );
    await publish(actions);
    return result;
  });
}
