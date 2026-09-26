import { and, eq, schema } from '@orbit/db';
import { unauthorized } from '@orbit/shared/errors';
import type { Actor, SyncAction } from '@orbit/shared/events';
import { authorizeIssueAction, type Principal } from '@orbit/shared/policy';
import { agentLifecycle } from '../auth/agent-identity-service.ts';
import type { Executor } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';

export interface AgentIssueBinding {
  readonly principal: Principal;
  readonly grantId: string;
  readonly agentIdentityId: string;
  readonly clientId: string;
  readonly scopes: string;
}

export interface LockedAgentIssueContext {
  readonly principal: Principal;
  readonly actor: Actor;
  readonly avatar: string | null;
  readonly principalName: string;
  readonly principalAvatar: string | null;
  readonly grantId: string;
  readonly agentIdentityId: string;
}

export function publicAgentAttribution(
  agent: LockedAgentIssueContext,
): NonNullable<SyncAction['attribution']> {
  return {
    actor: {
      type: 'agent',
      id: agent.agentIdentityId,
      name: agent.actor.name ?? 'Agent',
      avatar: agent.avatar,
      deleted: false,
    },
    principal: {
      type: 'user',
      id: agent.principal.userId,
      name: agent.principalName,
      avatar: agent.principalAvatar,
      deleted: false,
    },
  };
}

export async function lockAgentIssueContext(
  tx: Executor,
  binding: AgentIssueBinding,
  permission: 'issue:read' | 'issue:create' | 'issue:update' | 'issue:delete',
  team: { readonly id: string; readonly organizationId: string },
): Promise<LockedAgentIssueContext> {
  const [membership] = await tx
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, binding.principal.organizationId),
        eq(schema.member.userId, binding.principal.userId),
      ),
    )
    .limit(1)
    .for('update');
  if (membership === undefined) throw unauthorized('The agent owner is no longer a member.');
  const principal = await resolvePrincipal(
    binding.principal.userId,
    binding.principal.organizationId,
    tx,
  );
  const [identity] = await tx
    .select()
    .from(schema.agentIdentity)
    .where(eq(schema.agentIdentity.id, binding.agentIdentityId))
    .limit(1)
    .for('update');
  const [grant] = await tx
    .select()
    .from(schema.mcpGrant)
    .where(eq(schema.mcpGrant.id, binding.grantId))
    .limit(1)
    .for('update');
  if (
    identity === undefined ||
    grant === undefined ||
    grant.revokedAt !== null ||
    grant.agentIdentityId !== identity.id ||
    grant.userId !== principal.userId ||
    grant.clientId !== binding.clientId ||
    grant.organizationId !== principal.organizationId ||
    identity.clientId !== grant.clientId
  ) {
    throw unauthorized('This agent connection is unavailable.', {
      details: { reason: 'grant_revoked' },
    });
  }
  const scopes = grant.scopes.split(/\s+/).filter(Boolean);
  if (binding.scopes.split(/\s+/).some((scope) => !scopes.includes(scope))) {
    throw unauthorized('The agent grant has changed.', { details: { reason: 'grant_revoked' } });
  }
  authorizeIssueAction(
    {
      principal,
      scopes: binding.scopes.split(/\s+/).filter(Boolean),
      organizationId: identity.organizationId,
      ownerUserId: identity.ownerUserId,
      lifecycle: agentLifecycle(identity),
      connection: 'connected',
    },
    permission,
    { teamId: team.id, organizationId: team.organizationId },
  );
  const [owner] = await tx
    .select({ name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, principal.userId))
    .limit(1);
  return {
    principal,
    actor: { type: 'agent', id: identity.id, name: identity.name },
    avatar: identity.avatar,
    principalName: owner?.name ?? identity.ownerNameSnapshot,
    principalAvatar: owner?.image ?? null,
    grantId: grant.id,
    agentIdentityId: identity.id,
  };
}
