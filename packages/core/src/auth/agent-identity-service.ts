import { and, db, eq, isNull, schema, type Transaction } from '@orbit/db';
import { forbidden, validationFailed } from '@orbit/shared/errors';
import { assertAgentIdentityOwner } from '@orbit/shared/policy';
import { type AgentConsentSelection, agentConsentSelectionSchema } from '@orbit/shared/validators';
import { newId } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';
import {
  invalidateMcpGrant,
  isAgentMcpEnabled,
  lockMcpOwner,
  type RecordMcpGrantInput,
} from './mcp-token.ts';

const AGENT_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access', 'orbit.read']);

export function readOnlyAgentScopes(requested: readonly string[]): string {
  if (!requested.includes('orbit.read'))
    throw validationFailed('This client must request orbit.read to connect an identity.');
  return [...new Set(requested.filter((scope) => AGENT_SCOPES.has(scope)))].join(' ');
}

export function listAgentIdentitiesForConsent(userId: string, clientId: string) {
  return db
    .select({
      id: schema.agentIdentity.id,
      name: schema.agentIdentity.name,
      organizationId: schema.agentIdentity.organizationId,
    })
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.ownerUserId, userId),
        eq(schema.agentIdentity.clientId, clientId),
        isNull(schema.agentIdentity.deletedAt),
      ),
    );
}

export async function prepareAgentMcpGrant(
  tx: Transaction,
  input: RecordMcpGrantInput,
  selection: AgentConsentSelection,
  now: Date,
): Promise<string> {
  if (!isAgentMcpEnabled()) throw forbidden('Agent connections are not enabled.');
  const parsed = agentConsentSelectionSchema.parse(selection);
  await lockMcpOwner(tx, input.userId);
  const principal = await resolvePrincipal(input.userId, input.organizationId, tx);
  const [member] = await tx
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, input.userId),
        eq(schema.member.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for('share');
  const [client] = await tx
    .select()
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, input.clientId))
    .limit(1);
  const [owner] = await tx
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, input.userId))
    .limit(1);
  if (member === undefined || client === undefined || client.disabled || owner === undefined)
    throw forbidden('This connection is no longer available.');
  let identity: typeof schema.agentIdentity.$inferSelect | undefined;
  if ('identityId' in parsed) {
    [identity] = await tx
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, parsed.identityId))
      .limit(1);
  } else {
    [identity] = await tx
      .insert(schema.agentIdentity)
      .values({
        id: newId(),
        organizationId: input.organizationId,
        ownerUserId: input.userId,
        clientId: input.clientId,
        name: parsed.name,
        ownerNameSnapshot: owner.name,
        clientNameSnapshot: client.name,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  }
  if (identity === undefined || identity.deletedAt !== null)
    throw forbidden('Choose an available identity.');
  assertAgentIdentityOwner(principal, identity, input.clientId);
  const previous = await tx
    .select()
    .from(schema.mcpGrant)
    .where(
      and(
        eq(schema.mcpGrant.agentIdentityId, identity.id),
        eq(schema.mcpGrant.identityKind, 'agent'),
        isNull(schema.mcpGrant.revokedAt),
      ),
    );
  for (const grant of previous) await invalidateMcpGrant(tx, grant, now);
  const scopes = readOnlyAgentScopes(input.scopes.split(/\s+/).filter(Boolean));
  const grantId = newId();
  await tx.insert(schema.mcpGrant).values({
    id: grantId,
    clientId: input.clientId,
    userId: input.userId,
    organizationId: input.organizationId,
    scopes,
    identityKind: 'agent',
    agentIdentityId: identity.id,
    ownerMemberId: member.id,
    createdAt: now,
  });
  return grantId;
}
