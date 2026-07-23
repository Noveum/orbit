import { and, asc, count, db, eq, inArray, schema } from '@orbit/db';
import type { StateCategory } from '@orbit/shared/constants';
import { conflict, notFound } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, assertInTeam, teamScope } from '@orbit/shared/policy';
import { workflowStateCreateSchema, workflowStateUpdateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow } from '../internal.ts';
import { requireTeam } from '../org/team-service.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type WorkflowStateRow = typeof schema.workflowState.$inferSelect;

export const DEFAULT_WORKFLOW_STATES: readonly {
  name: string;
  category: StateCategory;
  color: string;
}[] = [
  { name: 'Triage', category: 'triage', color: '#E2A03F' },
  { name: 'Backlog', category: 'backlog', color: '#9CA3AF' },
  { name: 'Todo', category: 'unstarted', color: '#6B7280' },
  { name: 'In Progress', category: 'started', color: '#F2C94C' },
  { name: 'In Review', category: 'review', color: '#8B5CF6' },
  { name: 'Done', category: 'completed', color: '#22C55E' },
  { name: 'Canceled', category: 'canceled', color: '#EF4444' },
];

function stateScopes(row: WorkflowStateRow): string[] {
  return [scopes.organization(row.organizationId), scopes.team(row.teamId)];
}

export async function createDefaultWorkflowStates(
  executor: Executor,
  params: { organizationId: string; teamId: string; syncId: number },
): Promise<WorkflowStateRow[]> {
  return await executor
    .insert(schema.workflowState)
    .values(
      DEFAULT_WORKFLOW_STATES.map((state, position) => ({
        id: newId(),
        organizationId: params.organizationId,
        teamId: params.teamId,
        name: state.name,
        category: state.category,
        color: state.color,
        position,
        syncId: params.syncId,
      })),
    )
    .returning();
}

export async function listWorkflowStates(
  principal: Principal,
  teamId: string,
): Promise<WorkflowStateRow[]> {
  assertCan(principal, 'issue:read');
  const team = await requireTeam(principal, teamId);
  return await db
    .select()
    .from(schema.workflowState)
    .where(
      and(
        eq(schema.workflowState.organizationId, principal.organizationId),
        eq(schema.workflowState.teamId, team.id),
      ),
    )
    .orderBy(asc(schema.workflowState.position));
}

export async function defaultStateFor(
  executor: Executor,
  teamId: string,
  category: StateCategory,
): Promise<WorkflowStateRow | undefined> {
  const [row] = await executor
    .select()
    .from(schema.workflowState)
    .where(
      and(eq(schema.workflowState.teamId, teamId), eq(schema.workflowState.category, category)),
    )
    .orderBy(asc(schema.workflowState.position))
    .limit(1);
  return row;
}

export async function initialStateFor(
  executor: Executor,
  teamId: string,
): Promise<WorkflowStateRow> {
  const unstarted = await defaultStateFor(executor, teamId, 'unstarted');
  if (unstarted !== undefined) return unstarted;
  const backlog = await defaultStateFor(executor, teamId, 'backlog');
  if (backlog !== undefined) return backlog;
  const [any] = await executor
    .select()
    .from(schema.workflowState)
    .where(eq(schema.workflowState.teamId, teamId))
    .orderBy(asc(schema.workflowState.position))
    .limit(1);
  return requireRow(any, 'That team has no workflow states.');
}

export async function createWorkflowState(
  principal: Principal,
  input: unknown,
): Promise<{ state: WorkflowStateRow; actions: SyncAction[] }> {
  assertCan(principal, 'workflow:manage');
  const parsed = workflowStateCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const team = await requireTeam(principal, parsed.teamId, tx);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [maxPosition] = await tx
      .select({ total: count() })
      .from(schema.workflowState)
      .where(eq(schema.workflowState.teamId, team.id));
    const [state] = await tx
      .insert(schema.workflowState)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        teamId: team.id,
        name: parsed.name,
        category: parsed.category,
        color: parsed.color,
        position: parsed.position ?? maxPosition?.total ?? 0,
        syncId,
      })
      .returning();
    const row = requireRow(state, 'The workflow state could not be created.');
    return {
      state: row,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: stateScopes(row),
          action: 'insert',
          model: 'workflow_state',
          modelId: row.id,
          data: row,
          actor,
        }),
      ],
    };
  });
}

export async function updateWorkflowState(
  principal: Principal,
  stateId: string,
  input: unknown,
): Promise<{ state: WorkflowStateRow; actions: SyncAction[] }> {
  assertCan(principal, 'workflow:manage');
  const parsed = workflowStateUpdateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.workflowState)
      .where(
        and(
          eq(schema.workflowState.id, stateId),
          eq(schema.workflowState.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const current = requireRow(existing, 'That workflow state does not exist.');
    assertInTeam(principal, teamScope(current));

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const values: Partial<typeof schema.workflowState.$inferInsert> = { syncId };
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.category !== undefined) values.category = parsed.category;
    if (parsed.color !== undefined) values.color = parsed.color;
    if (parsed.position !== undefined) values.position = parsed.position;

    const [updated] = await tx
      .update(schema.workflowState)
      .set(values)
      .where(eq(schema.workflowState.id, stateId))
      .returning();
    const row = requireRow(updated, 'That workflow state does not exist.');
    return {
      state: row,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: stateScopes(row),
          action: 'update',
          model: 'workflow_state',
          modelId: row.id,
          data: row,
          actor,
        }),
      ],
    };
  });
}

export async function deleteWorkflowState(
  principal: Principal,
  stateId: string,
): Promise<SyncAction[]> {
  assertCan(principal, 'workflow:manage');

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.workflowState)
      .where(
        and(
          eq(schema.workflowState.id, stateId),
          eq(schema.workflowState.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const current = requireRow(existing, 'That workflow state does not exist.');
    assertInTeam(principal, teamScope(current));

    const [used] = await tx
      .select({ total: count() })
      .from(schema.issue)
      .where(eq(schema.issue.stateId, stateId));
    if ((used?.total ?? 0) > 0) {
      throw conflict('Move the issues in that status somewhere else first.', {
        details: { stateId, issues: used?.total ?? 0 },
      });
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx.delete(schema.workflowState).where(eq(schema.workflowState.id, stateId));
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: stateScopes(current),
        action: 'delete',
        model: 'workflow_state',
        modelId: stateId,
        data: { id: stateId, teamId: current.teamId },
        actor,
      }),
    ];
  });
}

export async function reorderWorkflowStates(
  principal: Principal,
  teamId: string,
  orderedStateIds: readonly string[],
): Promise<{ states: WorkflowStateRow[]; actions: SyncAction[] }> {
  assertCan(principal, 'workflow:manage');
  if (orderedStateIds.length === 0) throw notFound('Provide the states to reorder.');

  return await db.transaction(async (tx) => {
    await requireTeam(principal, teamId, tx);
    const existing = await tx
      .select()
      .from(schema.workflowState)
      .where(
        and(
          eq(schema.workflowState.teamId, teamId),
          inArray(schema.workflowState.id, [...orderedStateIds]),
        ),
      );
    if (existing.length !== orderedStateIds.length) {
      throw conflict('Some of those states do not belong to this team.');
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const states: WorkflowStateRow[] = [];
    for (const [position, id] of orderedStateIds.entries()) {
      const [updated] = await tx
        .update(schema.workflowState)
        .set({ position, syncId })
        .where(eq(schema.workflowState.id, id))
        .returning();
      if (updated !== undefined) states.push(updated);
    }

    return {
      states,
      actions: states.map((row) =>
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: stateScopes(row),
          action: 'update',
          model: 'workflow_state',
          modelId: row.id,
          data: row,
          actor,
        }),
      ),
    };
  });
}
