import { and, type Database, db, eq, schema, type Transaction } from '@orbit/db';
import { forbidden, unauthorized } from '@orbit/shared/errors';
import type { Actor } from '@orbit/shared/events';
import { assertAgentIssueWrite, type Permission, type Principal } from '@orbit/shared/policy';
import { principalActor } from '../activity/activity-service.ts';
import {
  isAgentIssueWriteEnabled,
  lockMcpOwner,
  type McpAccessContext,
  verifyMcpTokenBinding,
} from '../auth/mcp-token.ts';
import type { Executor } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';

export interface AgentIssueWriteContext {
  readonly grantId: string;
  readonly tokenId: string;
  readonly identityId: string;
  readonly ownerMemberId: string;
  readonly clientId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly scopes: string;
}

export function agentIssueWriteContext(access: McpAccessContext): AgentIssueWriteContext {
  if (
    access.identity.kind !== 'agent' ||
    access.ownerMemberId === null ||
    access.tokenId === undefined
  ) {
    throw unauthorized('A verified Agent connection is required.');
  }
  return {
    grantId: access.grantId,
    tokenId: access.tokenId,
    identityId: access.identity.id,
    ownerMemberId: access.ownerMemberId,
    clientId: access.clientId,
    userId: access.userId,
    organizationId: access.organizationId,
    scopes: access.scopes,
  };
}

const ACTORS = new WeakMap<Executor, Actor>();

export async function issueMutationActor(executor: Executor, principal: Principal): Promise<Actor> {
  return ACTORS.get(executor) ?? (await principalActor(executor, principal));
}

export async function issueWriteTransaction<T>(
  principal: Principal,
  permission: Permission,
  context: AgentIssueWriteContext | undefined,
  work: (tx: Transaction, current: Principal) => Promise<T>,
  database: Database = db,
): Promise<T> {
  return await database.transaction(async (tx) => {
    if (context === undefined) return work(tx, principal);
    if (!(isAgentIssueWriteEnabled() && context.scopes.split(/\s+/).includes('orbit.write'))) {
      throw forbidden('Agent Issue writing is not authorized.');
    }
    if (
      context.userId !== principal.userId ||
      context.organizationId !== principal.organizationId
    ) {
      throw unauthorized('The Agent connection does not match this workspace.');
    }
    await lockMcpOwner(tx, context.userId);
    const [token] = await tx
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.id, context.tokenId))
      .limit(1)
      .for('share');
    if (token === undefined || token.accessTokenExpiresAt <= new Date()) {
      throw unauthorized('The Agent credential has expired or been revoked.');
    }
    const access = await verifyMcpTokenBinding(tx, token, context.grantId, 'agent');
    if (
      access.identity.kind !== 'agent' ||
      access.identity.id !== context.identityId ||
      access.ownerMemberId !== context.ownerMemberId ||
      access.clientId !== context.clientId ||
      access.organizationId !== context.organizationId ||
      access.userId !== context.userId ||
      !access.scopes.split(/\s+/).includes('orbit.write')
    ) {
      throw unauthorized('The Agent authorization has changed.');
    }
    await tx
      .select({ id: schema.teamMember.id })
      .from(schema.teamMember)
      .innerJoin(schema.team, eq(schema.team.id, schema.teamMember.teamId))
      .where(
        and(
          eq(schema.teamMember.userId, context.userId),
          eq(schema.team.organizationId, context.organizationId),
        ),
      )
      .for('share');
    const current = await resolvePrincipal(context.userId, context.organizationId, tx);
    assertAgentIssueWrite(current, access.scopes, permission);
    ACTORS.set(tx, { type: 'agent', id: access.identity.id, name: access.identity.name });
    return work(tx, current);
  });
}
