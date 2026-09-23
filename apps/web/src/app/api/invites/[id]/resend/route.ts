import { resendInvite } from '@orbit/core';
import { assertEmailConfigured } from '@orbit/services/email';
import { assertCan } from '@orbit/shared/policy';
import { apiContext, handleRoute, publish } from '@/lib/api/handler.ts';
import { sendInviteEmail } from '@/lib/api/send-invite.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const context = await apiContext();
    assertCan(context.principal, 'member:invite');
    assertEmailConfigured();
    const { id } = await params;
    const result = await resendInvite(context.principal, id);
    await publish(result.actions);
    await sendInviteEmail({
      invitation: result.invitation,
      organizationName: context.organizationName,
      inviterName: context.userName,
    });
    return { invitation: result.invitation };
  });
}
