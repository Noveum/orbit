import { acceptInvite } from '@orbit/core';
import { unauthorized } from '@orbit/shared/errors';
import { headers } from 'next/headers';
import { handleRoute, publish } from '@/lib/api/handler.ts';
import { auth } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized('Sign in to accept this invite.');
    const { id } = await params;
    const accepted = await acceptInvite(id, session.user.id);
    await publish(accepted.actions);
    await auth.api.setActiveOrganization({
      body: { organizationId: accepted.organizationId },
      headers: await headers(),
    });
    return {
      organizationId: accepted.organizationId,
      alreadyAccepted: accepted.alreadyAccepted,
    };
  });
}
