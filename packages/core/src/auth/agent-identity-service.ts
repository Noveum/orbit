import { and, count, db, eq, inArray, isNull, schema, type Transaction } from '@orbit/db';
import { conflict, forbidden, notFound } from '@orbit/shared/errors';
import { type Actor, scopes } from '@orbit/shared/events';
import { agentIdentityAuthority, type Principal } from '@orbit/shared/policy';
import {
  type AgentIdentityAction,
  type AgentIdentitySelection,
  agentIdentityProfileSchema,
} from '@orbit/shared/validators';
import { principalActor, principalActorProfile } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';
import { stageIssueActions } from '../realtime/issue-outbox.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { canonicalIssueReads } from '../work/issue-actor-view.ts';
import { issueScopes } from '../work/issue-fields.ts';
import {
  clearAgentIssueResponsibility,
  type ResponsibilityClearCause,
} from '../work/issue-responsibility.ts';
import { labelIdsByIssue } from '../work/label-service.ts';
import { reviewerIdsByIssue } from '../work/reviewer-service.ts';

const ACTIVE_AGENT_LIMIT = 2;

type AgentIdentityRow = typeof schema.agentIdentity.$inferSelect;

function agentLifecycleClearCause(action: AgentIdentityAction): ResponsibilityClearCause | null {
  switch (action.action) {
    case 'pause':
      return 'agent_paused';
    case 'revoke_connection':
      return 'connection_revoked';
    case 'delete':
      return 'agent_deleted';
    default:
      return null;
  }
}

async function stageClearedAgentAssignments(
  tx: Transaction,
  changed: readonly (typeof schema.issue.$inferSelect)[],
  syncId: number,
  actor: Actor,
): Promise<void> {
  if (changed.length === 0) return;
  const ids = changed.map((issue) => issue.id);
  const [views, labels, reviewers] = await Promise.all([
    canonicalIssueReads(tx, changed),
    labelIdsByIssue(tx, ids),
    reviewerIdsByIssue(tx, ids),
  ]);
  for (const issue of views) {
    await stageIssueActions(tx, issue.id, [
      buildSyncAction({
        syncId,
        organizationId: issue.organizationId,
        scopes: issueScopes(issue),
        action: 'update',
        model: 'issue',
        modelId: issue.id,
        data: {
          ...issue,
          labelIds: labels.get(issue.id) ?? [],
          reviewerIds: reviewers.get(issue.id) ?? [],
        },
        actor,
      }),
    ]);
  }
}

async function recordAgentManagementAction(
  tx: Transaction,
  principal: Principal,
  before: AgentIdentityRow,
  after: AgentIdentityRow,
  action: AgentIdentityAction['action'],
  syncId: number,
  now: Date,
): Promise<AgentIdentityRow> {
  const [synced] = await tx
    .update(schema.agentIdentity)
    .set({ syncId })
    .where(eq(schema.agentIdentity.id, after.id))
    .returning();
  if (synced === undefined) throw new Error('The agent identity was not found.');
  const actor = await principalActor(tx, principal);
  const [actorProfile] = await tx
    .select({ avatar: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, principal.userId))
    .limit(1);
  const [activeGrant] = await tx
    .select({ id: schema.mcpGrant.id })
    .from(schema.mcpGrant)
    .where(and(eq(schema.mcpGrant.agentIdentityId, after.id), isNull(schema.mcpGrant.revokedAt)))
    .limit(1);
  const snapshot = (identity: AgentIdentityRow) => ({
    name: identity.name,
    avatar: identity.avatar,
    lifecycle: agentLifecycle(identity),
    ownerLocked: identity.ownerDisabledAt !== null,
    adminLocked: identity.adminDisabledAt !== null,
  });
  const current = {
    ...snapshot(after),
    connection: agentConnection(activeGrant?.id ?? null),
  };
  await tx.insert(schema.auditLog).values({
    id: newId(),
    organizationId: after.organizationId,
    actorType: 'user',
    actorId: principal.userId,
    actorName: actor.name ?? 'Someone',
    actorAvatar: actorProfile?.avatar ?? null,
    principalUserId: principal.userId,
    principalName: actor.name ?? 'Someone',
    principalAvatar: actorProfile?.avatar ?? null,
    action: `agent.${action}`,
    entityType: 'agent_identity',
    entityId: after.id,
    before: snapshot(before),
    after: current,
    createdAt: now,
  });
  const publicActor = {
    type: 'user' as const,
    id: principal.userId,
    name: actor.name ?? 'Someone',
    avatar: actorProfile?.avatar ?? null,
    deleted: false,
  };
  await stageIssueActions(
    tx,
    after.id,
    [
      buildSyncAction({
        syncId,
        organizationId: after.organizationId,
        scopes: [scopes.organization(after.organizationId)],
        action: 'update',
        model: 'agent_identity',
        modelId: after.id,
        data: {
          id: after.id,
          name: after.name,
          avatar: after.avatar,
          lifecycle: current.lifecycle,
        },
        actor,
        at: now,
      }),
    ],
    {
      attribution: {
        actor: publicActor,
        principal: { ...publicActor, id: principal.userId },
      },
    },
  );
  return synced;
}

export interface ConsentIdentityInput {
  readonly userId: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly selection: AgentIdentitySelection;
}

export interface PreparedPersonalAgentConsent {
  readonly identity: AgentIdentityRow;
  readonly activeGrantId: string | null;
}

export function agentLifecycle(identity: AgentIdentityRow): 'active' | 'disabled' | 'deleted' {
  if (identity.deletedAt !== null) return 'deleted';
  if (identity.ownerDisabledAt !== null || identity.adminDisabledAt !== null) return 'disabled';
  return 'active';
}

export function agentConnection(activeGrantId: string | null): 'connected' | 'disconnected' {
  return activeGrantId === null ? 'disconnected' : 'connected';
}

async function lockMembership(
  executor: Executor,
  organizationId: string,
  userId: string,
): Promise<void> {
  const [membership] = await executor
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1)
    .for('update');
  if (membership === undefined) throw forbidden('You are not a member of this workspace.');
}

async function assertActiveAgentCapacity(
  executor: Executor,
  organizationId: string,
  userId: string,
): Promise<void> {
  const [result] = await executor
    .select({ total: count() })
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.organizationId, organizationId),
        eq(schema.agentIdentity.ownerUserId, userId),
        isNull(schema.agentIdentity.deletedAt),
        isNull(schema.agentIdentity.ownerDisabledAt),
        isNull(schema.agentIdentity.adminDisabledAt),
      ),
    );
  if ((result?.total ?? 0) >= ACTIVE_AGENT_LIMIT) {
    throw conflict('This member already has the maximum number of active agents.', {
      details: { reason: 'agent_quota_exceeded' },
    });
  }
}

async function clientAndOwner(
  executor: Executor,
  clientId: string,
  userId: string,
): Promise<{ clientName: string; ownerName: string }> {
  const [client] = await executor
    .select({ name: schema.oauthApplication.name })
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, clientId))
    .limit(1);
  const [owner] = await executor
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (client === undefined || owner === undefined)
    throw notFound('That MCP client or member does not exist.');
  return { clientName: client.name, ownerName: owner.name };
}

async function assertOwnedAvatar(
  executor: Executor,
  ownerUserId: string,
  avatar: string | null,
): Promise<void> {
  if (avatar === null) return;
  const [owner] = await executor
    .select({ image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, ownerUserId))
    .limit(1);
  if (owner?.image !== avatar) {
    throw forbidden('Use an avatar uploaded by this agent owner.');
  }
}

async function lockedActiveGrantId(executor: Executor, identityId: string): Promise<string | null> {
  const [grant] = await executor
    .select({ id: schema.mcpGrant.id })
    .from(schema.mcpGrant)
    .where(and(eq(schema.mcpGrant.agentIdentityId, identityId), isNull(schema.mcpGrant.revokedAt)))
    .limit(1)
    .for('update');
  return grant?.id ?? null;
}

export async function preparePersonalAgentConsent(
  executor: Executor,
  input: ConsentIdentityInput,
): Promise<PreparedPersonalAgentConsent> {
  await lockMembership(executor, input.organizationId, input.userId);
  const names = await clientAndOwner(executor, input.clientId, input.userId);
  if ('createAgent' in input.selection) {
    const profile = agentIdentityProfileSchema.parse(input.selection.createAgent);
    await assertOwnedAvatar(executor, input.userId, profile.avatar);
    await assertActiveAgentCapacity(executor, input.organizationId, input.userId);
    const [identity] = await executor
      .insert(schema.agentIdentity)
      .values({
        id: newId(),
        organizationId: input.organizationId,
        ownerUserId: input.userId,
        ownerNameSnapshot: names.ownerName,
        clientId: input.clientId,
        clientNameSnapshot: names.clientName,
        name: profile.name,
        avatar: profile.avatar,
        syncId: await nextSyncId(executor),
      })
      .returning();
    return {
      identity: requireRow(identity, 'The agent identity could not be created.'),
      activeGrantId: null,
    };
  }

  const [identity] = await executor
    .select()
    .from(schema.agentIdentity)
    .where(eq(schema.agentIdentity.id, input.selection.agentIdentityId))
    .limit(1)
    .for('update');
  const selected = requireRow(identity, 'That agent identity does not exist.');
  if (
    selected.organizationId !== input.organizationId ||
    selected.ownerUserId !== input.userId ||
    selected.clientId !== input.clientId ||
    agentLifecycle(selected) !== 'active'
  ) {
    throw forbidden('That agent identity cannot be selected for this connection.');
  }
  const activeGrantId = await lockedActiveGrantId(executor, selected.id);
  if (activeGrantId !== null && !input.selection.replaceActiveGrant) {
    throw conflict('Confirm replacement before reconnecting this agent.');
  }
  return { identity: selected, activeGrantId };
}

async function revokeGrantAndTokens(
  executor: Executor,
  identityId: string,
  now: Date,
): Promise<void> {
  const grants = await executor
    .select({ id: schema.mcpGrant.id })
    .from(schema.mcpGrant)
    .where(and(eq(schema.mcpGrant.agentIdentityId, identityId), isNull(schema.mcpGrant.revokedAt)))
    .for('update');
  const grantIds = grants.map((grant) => grant.id);
  if (grantIds.length === 0) return;
  await executor
    .update(schema.mcpGrant)
    .set({ revokedAt: now, revokeReason: 'connection_revoked' })
    .where(inArray(schema.mcpGrant.id, grantIds));
  await executor
    .delete(schema.oauthAccessToken)
    .where(inArray(schema.oauthAccessToken.mcpGrantId, grantIds));
}

export async function deletePersonalAgentsForRemovedMember(
  executor: Executor,
  organizationId: string,
  ownerUserId: string,
  actorUserId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const candidates = await executor
    .select({ id: schema.agentIdentity.id })
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.organizationId, organizationId),
        eq(schema.agentIdentity.ownerUserId, ownerUserId),
        isNull(schema.agentIdentity.deletedAt),
      ),
    )
    .orderBy(schema.agentIdentity.id)
    .for('update');
  const deleted: string[] = [];
  for (const identity of candidates) {
    await revokeGrantAndTokens(executor, identity.id, now);
    await executor
      .update(schema.agentIdentity)
      .set({
        deletedAt: now,
        deletedByUserId: actorUserId,
        deletedActorIdSnapshot: actorUserId,
        deletedReason: 'membership_removed',
        updatedAt: now,
      })
      .where(eq(schema.agentIdentity.id, identity.id));
    deleted.push(identity.id);
  }
  return deleted;
}

async function revokeExactGrantAndTokens(
  executor: Executor,
  identityId: string,
  grantId: string,
  now: Date,
): Promise<void> {
  const [grant] = await executor
    .select({ id: schema.mcpGrant.id })
    .from(schema.mcpGrant)
    .where(
      and(
        eq(schema.mcpGrant.id, grantId),
        eq(schema.mcpGrant.agentIdentityId, identityId),
        isNull(schema.mcpGrant.revokedAt),
      ),
    )
    .limit(1)
    .for('update');
  if (grant === undefined) throw notFound('That connection does not exist.');
  await executor
    .update(schema.mcpGrant)
    .set({ revokedAt: now, revokeReason: 'connection_revoked' })
    .where(eq(schema.mcpGrant.id, grant.id));
  await executor
    .delete(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.mcpGrantId, grant.id));
}

async function lockedIdentityForAction(
  executor: Executor,
  principal: Principal,
  identityId: string,
): Promise<AgentIdentityRow> {
  const [identity] = await executor
    .select()
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.id, identityId),
        eq(schema.agentIdentity.organizationId, principal.organizationId),
      ),
    )
    .limit(1)
    .for('update');
  return requireRow(identity, 'That agent identity does not exist.');
}

async function lockActionMemberships(
  executor: Executor,
  principal: Principal,
  identityId: string,
): Promise<void> {
  const [candidate] = await executor
    .select({ ownerUserId: schema.agentIdentity.ownerUserId })
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.id, identityId),
        eq(schema.agentIdentity.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  const ownerUserId = requireRow(candidate, 'That agent identity does not exist.').ownerUserId;
  const members = [
    ...new Set([principal.userId, ...(ownerUserId === null ? [] : [ownerUserId])]),
  ].sort();
  for (const userId of members) {
    await lockMembership(executor, principal.organizationId, userId);
  }
}

export async function manageAgentIdentity(
  principal: Principal,
  identityId: string,
  action: AgentIdentityAction,
  now: Date = new Date(),
): Promise<AgentIdentityRow> {
  return await db.transaction(async (tx) => {
    await lockActionMemberships(tx, principal, identityId);
    const currentPrincipal = await resolvePrincipal(principal.userId, principal.organizationId, tx);
    const identity = await lockedIdentityForAction(tx, principal, identityId);
    const authority = agentIdentityAuthority(currentPrincipal, identity);
    if (authority === null) {
      throw forbidden('Only the agent owner or a workspace admin can manage this agent.', {
        details: { reason: 'agent_owner_required' },
      });
    }
    const isOwner = authority === 'owner';
    if (action.action === 'update_profile') {
      const updated = await updateAgentProfile(tx, identity, isOwner, action.profile, now);
      const syncId = await nextSyncId(tx);
      return await recordAgentManagementAction(
        tx,
        currentPrincipal,
        identity,
        updated,
        action.action,
        syncId,
        now,
      );
    }
    if (identity.deletedAt !== null) throw conflict('Deleted agents cannot be changed.');
    await applyLifecycleAction(tx, identity, principal.userId, isOwner, action, now);
    const syncId = await nextSyncId(tx);
    const clearCause = agentLifecycleClearCause(action);
    if (clearCause !== null) {
      const profile = await principalActorProfile(tx, principal);
      const changed = await clearAgentIssueResponsibility(
        tx,
        identity.organizationId,
        [identity.id],
        syncId,
        {
          actor: profile.actor,
          actorAvatar: profile.avatar,
          principalUserId: profile.actor.id,
          principalName: profile.actor.name ?? null,
          principalAvatar: profile.avatar,
          cause: clearCause,
          causeActorId: principal.userId,
        },
        now,
      );
      await stageClearedAgentAssignments(tx, changed, syncId, profile.actor);
    }
    const updated = await agentIdentityById(tx, identity.id);
    return await recordAgentManagementAction(
      tx,
      currentPrincipal,
      identity,
      updated,
      action.action,
      syncId,
      now,
    );
  });
}

export async function revokeAgentConnection(
  principal: Principal,
  identityId: string,
  grantId: string,
  now: Date = new Date(),
): Promise<AgentIdentityRow> {
  return await db.transaction(async (tx) => {
    await lockActionMemberships(tx, principal, identityId);
    const currentPrincipal = await resolvePrincipal(principal.userId, principal.organizationId, tx);
    const identity = await lockedIdentityForAction(tx, principal, identityId);
    if (agentIdentityAuthority(currentPrincipal, identity) === null) {
      throw forbidden('Only the agent owner or a workspace admin can manage this agent.', {
        details: { reason: 'agent_owner_required' },
      });
    }
    if (identity.deletedAt !== null) throw conflict('Deleted agents cannot be changed.');
    await revokeExactGrantAndTokens(tx, identity.id, grantId, now);
    const syncId = await nextSyncId(tx);
    const profile = await principalActorProfile(tx, principal);
    const changed = await clearAgentIssueResponsibility(
      tx,
      identity.organizationId,
      [identity.id],
      syncId,
      {
        actor: profile.actor,
        actorAvatar: profile.avatar,
        principalUserId: profile.actor.id,
        principalName: profile.actor.name ?? null,
        principalAvatar: profile.avatar,
        cause: 'connection_revoked',
        causeActorId: principal.userId,
      },
      now,
    );
    await stageClearedAgentAssignments(tx, changed, syncId, profile.actor);
    await tx
      .update(schema.agentIdentity)
      .set({
        connectionRevokedAt: now,
        connectionRevokedByUserId: principal.userId,
        connectionRevokedActorIdSnapshot: principal.userId,
        updatedAt: now,
      })
      .where(eq(schema.agentIdentity.id, identity.id));
    const updated = await agentIdentityById(tx, identity.id);
    return await recordAgentManagementAction(
      tx,
      currentPrincipal,
      identity,
      updated,
      'revoke_connection',
      syncId,
      now,
    );
  });
}

async function agentIdentityById(
  executor: Executor,
  identityId: string,
): Promise<AgentIdentityRow> {
  const [identity] = await executor
    .select()
    .from(schema.agentIdentity)
    .where(eq(schema.agentIdentity.id, identityId))
    .limit(1);
  return requireRow(identity, 'That agent identity does not exist.');
}

async function updateAgentProfile(
  executor: Executor,
  identity: AgentIdentityRow,
  isOwner: boolean,
  profile: { readonly name: string; readonly avatar: string | null },
  now: Date,
): Promise<AgentIdentityRow> {
  if (!isOwner || identity.deletedAt !== null) {
    throw forbidden('Only the agent owner can update an active agent profile.');
  }
  const parsed = agentIdentityProfileSchema.parse(profile);
  if (identity.ownerUserId === null) throw forbidden('The agent owner is unavailable.');
  await assertOwnedAvatar(executor, identity.ownerUserId, parsed.avatar);
  const [updated] = await executor
    .update(schema.agentIdentity)
    .set({ name: parsed.name, avatar: parsed.avatar, updatedAt: now })
    .where(eq(schema.agentIdentity.id, identity.id))
    .returning();
  return requireRow(updated, 'That agent identity does not exist.');
}

async function applyLifecycleAction(
  executor: Executor,
  identity: AgentIdentityRow,
  actorUserId: string,
  isOwner: boolean,
  action: Exclude<AgentIdentityAction, { readonly action: 'update_profile' }>,
  now: Date,
): Promise<void> {
  if (action.action === 'pause') {
    await pauseAgentIdentity(executor, identity, actorUserId, isOwner, now);
    return;
  }
  if (action.action === 'resume') {
    await resumeAgentIdentity(executor, identity, actorUserId, isOwner, now);
    return;
  }
  if (action.action === 'revoke_connection') {
    await revokeGrantAndTokens(executor, identity.id, now);
    await executor
      .update(schema.agentIdentity)
      .set({
        connectionRevokedAt: now,
        connectionRevokedByUserId: actorUserId,
        connectionRevokedActorIdSnapshot: actorUserId,
        updatedAt: now,
      })
      .where(eq(schema.agentIdentity.id, identity.id));
    return;
  }
  await revokeGrantAndTokens(executor, identity.id, now);
  await executor
    .update(schema.agentIdentity)
    .set({
      deletedAt: now,
      deletedByUserId: actorUserId,
      deletedActorIdSnapshot: actorUserId,
      deletedReason: action.reason,
      updatedAt: now,
    })
    .where(eq(schema.agentIdentity.id, identity.id));
}

async function pauseAgentIdentity(
  executor: Executor,
  identity: AgentIdentityRow,
  actorUserId: string,
  isOwner: boolean,
  now: Date,
): Promise<void> {
  if (isOwner ? identity.ownerDisabledAt !== null : identity.adminDisabledAt !== null) return;
  const update = isOwner
    ? {
        ownerDisabledAt: now,
        ownerDisabledByUserId: actorUserId,
        ownerDisabledActorIdSnapshot: actorUserId,
        updatedAt: now,
      }
    : {
        adminDisabledAt: now,
        adminDisabledByUserId: actorUserId,
        adminDisabledActorIdSnapshot: actorUserId,
        updatedAt: now,
      };
  await executor
    .update(schema.agentIdentity)
    .set(update)
    .where(eq(schema.agentIdentity.id, identity.id));
  await revokeGrantAndTokens(executor, identity.id, now);
}

async function resumeAgentIdentity(
  executor: Executor,
  identity: AgentIdentityRow,
  actorUserId: string,
  isOwner: boolean,
  now: Date,
): Promise<void> {
  if (isOwner) {
    if (identity.ownerDisabledByUserId !== actorUserId) {
      throw forbidden('Only the owner lock holder can resume this agent.');
    }
    if (identity.adminDisabledAt === null) {
      await assertActiveAgentCapacity(executor, identity.organizationId, actorUserId);
    }
    await executor
      .update(schema.agentIdentity)
      .set({
        ownerDisabledAt: null,
        ownerResumedAt: now,
        ownerResumedByUserId: actorUserId,
        ownerResumedActorIdSnapshot: actorUserId,
        updatedAt: now,
      })
      .where(eq(schema.agentIdentity.id, identity.id));
    return;
  }
  if (identity.adminDisabledByUserId !== actorUserId) {
    throw forbidden('Only the admin lock holder can resume this agent.');
  }
  if (identity.ownerDisabledAt === null) {
    const ownerUserId = requireRow(
      identity.ownerUserId ?? undefined,
      'The agent owner is unavailable.',
    );
    await assertActiveAgentCapacity(executor, identity.organizationId, ownerUserId);
  }
  await executor
    .update(schema.agentIdentity)
    .set({
      adminDisabledAt: null,
      adminResumedAt: now,
      adminResumedByUserId: actorUserId,
      adminResumedActorIdSnapshot: actorUserId,
      updatedAt: now,
    })
    .where(eq(schema.agentIdentity.id, identity.id));
}

export async function listSelectablePersonalAgents(
  userId: string,
  organizationId: string,
  clientId: string,
): Promise<(AgentIdentityRow & { readonly activeGrantId: string | null })[]> {
  const identities = await db
    .select()
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.organizationId, organizationId),
        eq(schema.agentIdentity.ownerUserId, userId),
        eq(schema.agentIdentity.clientId, clientId),
        isNull(schema.agentIdentity.deletedAt),
        isNull(schema.agentIdentity.ownerDisabledAt),
        isNull(schema.agentIdentity.adminDisabledAt),
      ),
    );
  return await Promise.all(
    identities.map(async (identity) => {
      const [grant] = await db
        .select({ id: schema.mcpGrant.id })
        .from(schema.mcpGrant)
        .where(
          and(eq(schema.mcpGrant.agentIdentityId, identity.id), isNull(schema.mcpGrant.revokedAt)),
        )
        .limit(1);
      return { ...identity, activeGrantId: grant?.id ?? null };
    }),
  );
}
