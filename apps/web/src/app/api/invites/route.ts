import { createInvites, listPendingInvites } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';
import { sendInviteEmail } from '@/lib/api/send-invite.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    return { invites: await listPendingInvites(principal) };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const context = await apiContext();
    const result = await createInvites(context.principal, await readJson(request));
    await publish(result.actions);
    for (const created of result.invites) {
      await sendInviteEmail({
        invitation: created.invitation,
        organizationName: context.organizationName,
        inviterName: context.userName,
      });
    }
    return { invites: result.invites.map((created) => created.invitation) };
  });
}
