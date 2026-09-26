import { and, asc, eq, inArray, isNull, schema } from '@orbit/db';
import { OPEN_STATE_CATEGORIES } from '@orbit/shared/constants';
import { forbidden, validationFailed } from '@orbit/shared/errors';
import type { Actor } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { type ActivityChange, appendActivities } from '../activity/activity-service.ts';
import { type Executor, newId } from '../internal.ts';
import type { LockedAgentIssueContext } from './agent-issue-context.ts';

type Issue = typeof schema.issue.$inferSelect;

export const RESPONSIBILITY_CLEAR_CAUSES = [
  'membership_removed',
  'team_access_lost',
  'agent_paused',
  'connection_revoked',
  'agent_deleted',
] as const;

export type ResponsibilityClearCause = (typeof RESPONSIBILITY_CLEAR_CAUSES)[number];

export const SYSTEM_ACTOR: Actor = { type: 'system', id: 'system', name: 'System' };

export interface ResponsibilityClearAttribution {
  readonly actor: Actor;
  readonly actorAvatar?: string | null;
  readonly principalUserId?: string | null;
  readonly principalName?: string | null;
  readonly principalAvatar?: string | null;
  readonly grantId?: string | null;
  readonly cause?: ResponsibilityClearCause;
  readonly causeActorId?: string | null;
}

export const SYSTEM_CLEAR_ATTRIBUTION: ResponsibilityClearAttribution = { actor: SYSTEM_ACTOR };

interface ResponsibilityChange {
  readonly field: 'assignee' | 'ownerUserId';
  readonly from: unknown;
  readonly to: unknown;
}

function assigneeActor(userId: string | null, agentId: string | null): unknown {
  if (agentId !== null) return { type: 'agent', id: agentId };
  if (userId !== null) return { type: 'user', id: userId };
  return null;
}

export function issueUpdateResponsibility(
  current: Issue,
  patch: {
    readonly assigneeId?: string | null | undefined;
    readonly assigneeAgentId?: string | null | undefined;
  },
  principalUserId: string,
): {
  values: Partial<Pick<Issue, 'assigneeId' | 'assigneeUserId' | 'assigneeAgentId' | 'ownerUserId'>>;
  changes: ResponsibilityChange[];
} {
  if (
    patch.assigneeId !== undefined &&
    patch.assigneeAgentId !== undefined &&
    patch.assigneeId !== null &&
    patch.assigneeAgentId !== null
  )
    throw validationFailed('Choose one assignee actor.');
  if (patch.assigneeId === undefined && patch.assigneeAgentId === undefined)
    return { values: {}, changes: [] };
  const assigneeId = patch.assigneeAgentId === undefined ? (patch.assigneeId ?? null) : null;
  const assigneeAgentId = patch.assigneeAgentId === undefined ? null : patch.assigneeAgentId;
  const changes: ResponsibilityChange[] = [];
  if (current.assigneeId !== assigneeId || current.assigneeAgentId !== assigneeAgentId)
    changes.push({
      field: 'assignee',
      from: assigneeActor(current.assigneeId, current.assigneeAgentId),
      to: assigneeActor(assigneeId, assigneeAgentId),
    });
  if (changes.length === 0) return { values: {}, changes };
  const ownerUserId =
    current.ownerUserId ?? assigneeId ?? (assigneeAgentId === null ? null : principalUserId);
  if (current.ownerUserId !== ownerUserId)
    changes.push({ field: 'ownerUserId', from: current.ownerUserId, to: ownerUserId });
  return {
    values: { assigneeId, assigneeUserId: assigneeId, assigneeAgentId, ownerUserId },
    changes,
  };
}

export function issueCreateResponsibility(
  assigneeUserId: string | null,
  assigneeAgentId: string | null,
  principalUserId: string,
): {
  assigneeId: string | null;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  ownerUserId: string | null;
} {
  if (assigneeUserId !== null && assigneeAgentId !== null)
    throw validationFailed('Choose one assignee actor.');
  return {
    assigneeId: assigneeUserId,
    assigneeUserId,
    assigneeAgentId,
    ownerUserId: assigneeUserId ?? (assigneeAgentId === null ? null : principalUserId),
  };
}

export async function assertAgentAssignable(
  tx: Executor,
  principal: Principal,
  identityId: string,
  agent: LockedAgentIssueContext | null,
): Promise<void> {
  const [identity] = await tx
    .select()
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.id, identityId),
        eq(schema.agentIdentity.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  const [activeGrant] = await tx
    .select({ id: schema.mcpGrant.id })
    .from(schema.mcpGrant)
    .where(and(eq(schema.mcpGrant.agentIdentityId, identityId), isNull(schema.mcpGrant.revokedAt)))
    .limit(1);
  if (
    identity === undefined ||
    identity.ownerUserId !== principal.userId ||
    identity.deletedAt !== null ||
    identity.ownerDisabledAt !== null ||
    identity.adminDisabledAt !== null ||
    activeGrant === undefined ||
    (agent !== null && agent.agentIdentityId !== identityId)
  ) {
    throw forbidden('This agent cannot be assigned to the issue.', {
      details: { reason: 'agent_not_assignable' },
    });
  }
}

export async function clearAgentIssueResponsibility(
  tx: Executor,
  organizationId: string,
  identityIds: readonly string[],
  syncId: number,
  attribution: ResponsibilityClearAttribution,
  now: Date = new Date(),
): Promise<Issue[]> {
  if (identityIds.length === 0) return [];
  const openStates = tx
    .select({ id: schema.workflowState.id })
    .from(schema.workflowState)
    .where(inArray(schema.workflowState.category, [...OPEN_STATE_CATEGORIES]));
  const rows = await tx
    .select()
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.organizationId, organizationId),
        inArray(schema.issue.assigneeAgentId, [...identityIds]),
        inArray(schema.issue.stateId, openStates),
      ),
    )
    .orderBy(asc(schema.issue.id))
    .for('update');
  const changed: Issue[] = [];
  for (const row of rows) {
    const [updated] = await tx
      .update(schema.issue)
      .set({ assigneeAgentId: null, updatedAt: now, syncId })
      .where(eq(schema.issue.id, row.id))
      .returning();
    if (updated === undefined) throw new Error('Issue responsibility update lost its locked row');
    await tx.insert(schema.issueActivity).values({
      id: newId(),
      organizationId,
      issueId: row.id,
      actorType: attribution.actor.type,
      actorId: attribution.actor.id,
      actorName: attribution.actor.name ?? 'System',
      actorAvatar: attribution.actorAvatar ?? null,
      principalUserId: attribution.principalUserId ?? null,
      principalName: attribution.principalName ?? null,
      principalAvatar: attribution.principalAvatar ?? null,
      grantId: attribution.grantId ?? null,
      field: 'assignee',
      fromValue: { type: 'agent', id: row.assigneeAgentId },
      toValue: null,
      cause: attribution.cause ?? null,
      causeActorId: attribution.causeActorId ?? null,
      syncId,
      createdAt: now,
    });
    changed.push(updated);
  }
  return changed;
}

function clearedResponsibility(
  row: Issue,
  userId: string,
  nextAssignee: string | null,
  agentIdentityIds: readonly string[],
) {
  const humanAssignee =
    row.assigneeAgentId === null && (row.assigneeUserId ?? row.assigneeId) === userId;
  const owner = row.ownerUserId === userId;
  const inactiveAgent =
    row.assigneeAgentId !== null && agentIdentityIds.includes(row.assigneeAgentId);
  const changes: ActivityChange[] = [];
  if (humanAssignee || inactiveAgent || (owner && row.assigneeAgentId !== null)) {
    changes.push({
      field: 'assignee',
      from:
        row.assigneeAgentId === null
          ? { type: 'user', id: row.assigneeUserId ?? row.assigneeId }
          : { type: 'agent', id: row.assigneeAgentId },
      to: humanAssignee && nextAssignee !== null ? { type: 'user', id: nextAssignee } : null,
    });
  }
  if (owner) changes.push({ field: 'ownerId', from: userId, to: null });
  return {
    humanAssignee,
    owner,
    inactiveAgent,
    changes,
    fields: {
      assigneeId: humanAssignee ? nextAssignee : row.assigneeId,
      assigneeUserId: humanAssignee ? nextAssignee : row.assigneeUserId,
      assigneeAgentId: owner || inactiveAgent ? null : row.assigneeAgentId,
      ownerUserId: owner ? null : row.ownerUserId,
    },
  };
}

async function clearIssue(
  tx: Executor,
  row: Issue,
  userId: string,
  syncId: number,
  nextAssignee: string | null,
  agentIdentityIds: readonly string[],
  attribution: ResponsibilityClearAttribution,
) {
  const change = clearedResponsibility(row, userId, nextAssignee, agentIdentityIds);
  const reviews = await tx
    .delete(schema.issueReviewer)
    .where(and(eq(schema.issueReviewer.issueId, row.id), eq(schema.issueReviewer.userId, userId)))
    .returning();
  if (!(change.humanAssignee || change.owner || change.inactiveAgent) && reviews.length === 0)
    return null;
  const [updated] = await tx
    .update(schema.issue)
    .set({ ...change.fields, updatedAt: new Date(), syncId })
    .where(eq(schema.issue.id, row.id))
    .returning();
  if (!updated) throw new Error('Issue responsibility update lost its locked row');
  await appendActivities(
    tx,
    change.changes.map((activity) => ({
      ...activity,
      organizationId: row.organizationId,
      issueId: row.id,
      syncId,
      actor: attribution.actor,
      actorAvatar: attribution.actorAvatar ?? null,
      principalUserId: attribution.principalUserId ?? null,
      principalName: attribution.principalName ?? null,
      principalAvatar: attribution.principalAvatar ?? null,
      grantId: attribution.grantId ?? null,
      cause: attribution.cause ?? null,
      causeActorId: attribution.causeActorId ?? null,
    })),
  );
  return { updated, reassigned: change.humanAssignee };
}

export async function clearHumanIssueResponsibility(
  tx: Executor,
  organizationId: string,
  userId: string,
  syncId: number,
  options: {
    readonly teamId?: string;
    readonly nextAssignee?: string | null;
    readonly agentIdentityIds?: readonly string[];
    readonly cause: ResponsibilityClearCause;
    readonly causeActorId?: string | null;
  },
) {
  const attribution: ResponsibilityClearAttribution = {
    actor: SYSTEM_ACTOR,
    cause: options.cause,
    causeActorId: options.causeActorId ?? null,
  };
  const openStates = tx
    .select({ id: schema.workflowState.id })
    .from(schema.workflowState)
    .where(inArray(schema.workflowState.category, [...OPEN_STATE_CATEGORIES]));
  const rows = await tx
    .select()
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.organizationId, organizationId),
        inArray(schema.issue.stateId, openStates),
        options.teamId === undefined ? undefined : eq(schema.issue.teamId, options.teamId),
      ),
    )
    .orderBy(asc(schema.issue.id))
    .for('update');
  const changed: Issue[] = [];
  const reassigned: string[] = [];
  for (const row of rows) {
    const result = await clearIssue(
      tx,
      row,
      userId,
      syncId,
      options.nextAssignee ?? null,
      options.agentIdentityIds ?? [],
      attribution,
    );
    if (result === null) continue;
    changed.push(result.updated);
    if (result.reassigned) reassigned.push(row.id);
  }
  return { changed, reassigned };
}
