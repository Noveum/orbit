import { dismissAiConnectHint } from '@orbit/core';
import { unauthorized } from '@orbit/shared/errors';
import { handleRoute } from '@/lib/api/handler.ts';
import { getSession } from '@/lib/auth/session.ts';

export async function DELETE(): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    await dismissAiConnectHint(session.user.id);
    return { dismissed: true };
  });
}
