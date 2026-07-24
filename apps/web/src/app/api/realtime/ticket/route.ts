import { forbidden, unauthorized } from '@orbit/shared/errors';
import {
  REALTIME_TICKET_TTL_MS,
  realtimeTicketRequestSchema,
  signRealtimeTicket,
} from '@orbit/shared/events/ticket';
import { handleRoute, readJson } from '@/lib/api/handler.ts';
import { resolveMembership } from '@/lib/auth/principal.ts';
import { getSession } from '@/lib/auth/session.ts';
import { serverEnv } from '@/lib/env.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();

    const body = realtimeTicketRequestSchema.parse(await readJson(request));
    const membership = await resolveMembership(
      session.user.id,
      body.organizationId ?? session.session.activeOrganizationId ?? null,
    );
    if (membership === null) throw forbidden('You are not a member of this workspace.');
    if (
      body.organizationId !== undefined &&
      membership.principal.organizationId !== body.organizationId
    ) {
      throw forbidden('You are not a member of this workspace.');
    }

    const ticket = signRealtimeTicket(
      {
        userId: session.user.id,
        organizationId: membership.principal.organizationId,
        sessionId: session.session.id,
        exp: Date.now() + REALTIME_TICKET_TTL_MS,
      },
      serverEnv().BETTER_AUTH_SECRET,
    );

    return { ticket };
  });
}
