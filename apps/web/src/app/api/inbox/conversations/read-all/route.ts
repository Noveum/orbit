import { markAllInboxConversationsRead } from '@orbit/core';
import { handle, publish } from '@/lib/api/handler.ts';

export async function POST(): Promise<Response> {
  return await handle(async (principal) => {
    const { actions, ...result } = await markAllInboxConversationsRead(principal);
    await publish(actions);
    return result;
  });
}
