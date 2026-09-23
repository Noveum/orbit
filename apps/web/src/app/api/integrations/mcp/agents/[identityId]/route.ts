import { manageAgentIdentity } from '@orbit/core';
import { agentFeatureEnabled } from '@orbit/shared';
import { notFound } from '@orbit/shared/errors';
import { agentIdentityActionSchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, readJson, routeId } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ identityId: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return await handleRoute(async () => {
    if (!agentFeatureEnabled('agent_identity_read')) {
      throw notFound('Agent identity management is unavailable.');
    }
    const { principal } = await apiContext();
    const identityId = routeId((await params).identityId, 'agent identity');
    const action = agentIdentityActionSchema.parse(await readJson(request));
    return { identity: await manageAgentIdentity(principal, identityId, action) };
  });
}
