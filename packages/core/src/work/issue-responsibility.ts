import { and, asc, eq, inArray, schema } from '@orbit/db';
import { OPEN_STATE_CATEGORIES } from '@orbit/shared/constants';
import type { Actor } from '@orbit/shared/events';
import { type ActivityChange, appendActivities } from '../activity/activity-service.ts';
import { type Executor, newId } from '../internal.ts';

type Issue = typeof schema.issue.$inferSelect;

export async function clearAgentIssueResponsibility(
  tx: Executor,
  organizationId: string,
  identityIds: readonly string[],
  syncId: number,
  actor: Actor,
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
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name ?? 'System',
      principalUserId: actor.type === 'user' ? actor.id : null,
      principalName: actor.type === 'user' ? (actor.name ?? null) : null,
      grantId: null,
      field: 'assignee',
      fromValue: { type: 'agent', id: row.assigneeAgentId },
      toValue: null,
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
      actor: { type: 'system', id: 'system', name: 'System' },
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
  } = {},
) {
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
    );
    if (result === null) continue;
    changed.push(result.updated);
    if (result.reassigned) reassigned.push(row.id);
  }
  return { changed, reassigned };
}
