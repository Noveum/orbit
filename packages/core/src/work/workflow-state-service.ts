import { and, asc, count, db, desc, eq, inArray, ne, schema } from '@orbit/db';
import { isOpenCategory, type StateCategory } from '@orbit/shared/constants';
import { conflict, validationFailed } from '@orbit/shared/errors';
import type { Actor, SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, assertInTeam, teamScope } from '@orbit/shared/policy';
import {
  workflowStateCreateSchema,
  workflowStateReorderSchema,
  workflowStateUpdateSchema,
} from '@orbit/shared/validators';
import { appendActivities, principalActor } from '../activity/activity-service.ts';
import { type Executor, isUniqueViolation, newId, requireRow } from '../internal.ts';
import { requireTeam } from '../org/team-service.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { applyStateTimestamps, type IssueRow, issueScopes } from './issue-fields.ts';
import { labelIdsByIssue } from './label-service.ts';
import { reviewerIdsByIssue } from './reviewer-service.ts';

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
  { name: 'Duplicate', category: 'canceled', color: '#94A3B8' },
];

const NAME_TAKEN = 'That team already has a status with that name.';
const MISSING_STATE = 'That workflow state does not exist.';

async function refusingDuplicates<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(NAME_TAKEN);
    throw error;
  }
}

function stateScopes(row: Pick<WorkflowStateRow, 'teamId'>): string[] {
  return [scopes.team(row.teamId)];
}

function stateAction(
  row: WorkflowStateRow,
  syncId: number,
  actor: Actor,
  action: 'insert' | 'update',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: stateScopes(row),
    action,
    model: 'workflow_state',
    modelId: row.id,
    data: row,
    actor,
  });
}

async function ownedState(
  executor: Executor,
  principal: Principal,
  stateId: string,
): Promise<WorkflowStateRow> {
  const [row] = await executor
    .select()
    .from(schema.workflowState)
    .where(
      and(
        eq(schema.workflowState.id, stateId),
        eq(schema.workflowState.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  const current = requireRow(row, MISSING_STATE);
  assertInTeam(principal, teamScope(current));
  return current;
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

export async function listWorkflowStatesForTeams(
  principal: Principal,
  teamIds: readonly string[],
): Promise<WorkflowStateRow[]> {
  assertCan(principal, 'issue:read');
  const reachable =
    principal.role === 'admin'
      ? [...new Set(teamIds)]
      : [...new Set(teamIds)].filter((teamId) => principal.teamIds.includes(teamId));
  if (reachable.length === 0) return [];
  return await db
    .select()
    .from(schema.workflowState)
    .where(
      and(
        eq(schema.workflowState.organizationId, principal.organizationId),
        inArray(schema.workflowState.teamId, reachable),
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
  const triage = await defaultStateFor(executor, teamId, 'triage');
  if (triage !== undefined) return triage;
  const unstarted = await defaultStateFor(executor, teamId, 'unstarted');
  if (unstarted !== undefined) return unstarted;
  const backlog = await defaultStateFor(executor, teamId, 'backlog');
  if (backlog !== undefined) return backlog;
  const board = await executor
    .select()
    .from(schema.workflowState)
    .where(eq(schema.workflowState.teamId, teamId))
    .orderBy(asc(schema.workflowState.position));
  const open = board.find((state) => isOpenCategory(state.category));
  return requireRow(open ?? board[0], 'That team has no workflow states.');
}

async function issuesInState(
  executor: Executor,
  organizationId: string,
  stateId: string,
): Promise<IssueRow[]> {
  return await executor
    .select()
    .from(schema.issue)
    .where(and(eq(schema.issue.organizationId, organizationId), eq(schema.issue.stateId, stateId)));
}

interface RestateParams {
  readonly issues: readonly IssueRow[];
  readonly stateId: string;
  readonly category: string;
  readonly syncId: number;
  readonly actor: Actor;
  readonly moved: boolean;
}

async function restateIssues(executor: Executor, params: RestateParams): Promise<SyncAction[]> {
  const now = new Date();
  const issueIds = params.issues.map((issue) => issue.id);
  const [labels, reviewers] = await Promise.all([
    labelIdsByIssue(executor, issueIds),
    reviewerIdsByIssue(executor, issueIds),
  ]);
  const actions: SyncAction[] = [];
  for (const issue of params.issues) {
    const timestamps = applyStateTimestamps(issue, params.category, now);
    const [row] = await executor
      .update(schema.issue)
      .set({
        stateId: params.stateId,
        ...timestamps,
        ...(params.moved ? {} : { stateEnteredAt: issue.stateEnteredAt }),
        updatedAt: now,
        syncId: params.syncId,
      })
      .where(eq(schema.issue.id, issue.id))
      .returning();
    if (row === undefined) continue;
    actions.push(
      buildSyncAction({
        syncId: params.syncId,
        organizationId: row.organizationId,
        scopes: issueScopes(row),
        action: 'update',
        model: 'issue',
        modelId: row.id,
        data: {
          ...row,
          labelIds: labels.get(row.id) ?? [],
          reviewerIds: reviewers.get(row.id) ?? [],
        },
        actor: params.actor,
      }),
    );
  }
  return actions;
}

async function nextPosition(executor: Executor, teamId: string): Promise<number> {
  const [row] = await executor
    .select({ position: schema.workflowState.position })
    .from(schema.workflowState)
    .where(eq(schema.workflowState.teamId, teamId))
    .orderBy(desc(schema.workflowState.position))
    .limit(1);
  return row === undefined ? 0 : row.position + 1;
}

export async function createWorkflowState(
  principal: Principal,
  input: unknown,
): Promise<{ state: WorkflowStateRow; actions: SyncAction[] }> {
  assertCan(principal, 'workflow:manage');
  const parsed = workflowStateCreateSchema.parse(input);

  return await refusingDuplicates(async () =>
    db.transaction(async (tx) => {
      const team = await requireTeam(principal, parsed.teamId, tx);
      const syncId = await nextSyncId(tx);
      const actor = await principalActor(tx, principal);
      const [state] = await tx
        .insert(schema.workflowState)
        .values({
          id: newId(),
          organizationId: principal.organizationId,
          teamId: team.id,
          name: parsed.name,
          category: parsed.category,
          color: parsed.color,
          position: await nextPosition(tx, team.id),
          syncId,
        })
        .returning();
      const row = requireRow(state, 'The workflow state could not be created.');
      return { state: row, actions: [stateAction(row, syncId, actor, 'insert')] };
    }),
  );
}

function stateChanges(
  current: WorkflowStateRow,
  parsed: ReturnType<typeof workflowStateUpdateSchema.parse>,
): Partial<typeof schema.workflowState.$inferInsert> {
  const values: Partial<typeof schema.workflowState.$inferInsert> = {};
  if (parsed.name !== undefined && parsed.name !== current.name) values.name = parsed.name;
  if (parsed.category !== undefined && parsed.category !== current.category) {
    values.category = parsed.category;
  }
  if (parsed.color !== undefined && parsed.color !== current.color) values.color = parsed.color;
  return values;
}

export async function updateWorkflowState(
  principal: Principal,
  stateId: string,
  input: unknown,
): Promise<{ state: WorkflowStateRow; actions: SyncAction[] }> {
  assertCan(principal, 'workflow:manage');
  const parsed = workflowStateUpdateSchema.parse(input);

  return await refusingDuplicates(async () =>
    db.transaction(async (tx) => {
      const current = await ownedState(tx, principal, stateId);
      const values = stateChanges(current, parsed);
      if (Object.keys(values).length === 0) return { state: current, actions: [] };

      const syncId = await nextSyncId(tx);
      const actor = await principalActor(tx, principal);
      const [updated] = await tx
        .update(schema.workflowState)
        .set({ ...values, syncId })
        .where(eq(schema.workflowState.id, current.id))
        .returning();
      const row = requireRow(updated, MISSING_STATE);

      const recategorised =
        values.category === undefined
          ? []
          : await restateIssues(tx, {
              issues: await issuesInState(tx, current.organizationId, current.id),
              stateId: current.id,
              category: row.category,
              syncId,
              actor,
              moved: false,
            });

      return { state: row, actions: [stateAction(row, syncId, actor, 'update'), ...recategorised] };
    }),
  );
}

async function targetForMove(
  executor: Executor,
  current: WorkflowStateRow,
  moveToStateId: string | undefined,
  occupants: number,
): Promise<WorkflowStateRow> {
  if (moveToStateId === undefined) {
    throw conflict('Name a status to move those issues to before deleting this one.', {
      details: { stateId: current.id, issues: occupants },
    });
  }
  const [row] = await executor
    .select()
    .from(schema.workflowState)
    .where(
      and(
        eq(schema.workflowState.id, moveToStateId),
        eq(schema.workflowState.organizationId, current.organizationId),
        eq(schema.workflowState.teamId, current.teamId),
        ne(schema.workflowState.id, current.id),
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw validationFailed('That replacement status is not another status on this team.');
  }
  return row;
}

export interface DeleteWorkflowStateOptions {
  readonly moveToStateId?: string | undefined;
}

export async function deleteWorkflowState(
  principal: Principal,
  stateId: string,
  options: DeleteWorkflowStateOptions = {},
): Promise<SyncAction[]> {
  assertCan(principal, 'workflow:manage');

  return await db.transaction(async (tx) => {
    const current = await ownedState(tx, principal, stateId);

    const [total] = await tx
      .select({ states: count() })
      .from(schema.workflowState)
      .where(eq(schema.workflowState.teamId, current.teamId));
    if ((total?.states ?? 0) <= 1) {
      throw conflict('A team keeps at least one status, so this one cannot go.', {
        details: { stateId: current.id },
      });
    }

    const occupants = await issuesInState(tx, current.organizationId, current.id);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);

    const moved =
      occupants.length === 0
        ? []
        : await moveOccupants(tx, { current, occupants, options, syncId, actor, principal });

    await tx.delete(schema.workflowState).where(eq(schema.workflowState.id, current.id));
    return [
      buildSyncAction({
        syncId,
        organizationId: current.organizationId,
        scopes: stateScopes(current),
        action: 'delete',
        model: 'workflow_state',
        modelId: current.id,
        data: { id: current.id, teamId: current.teamId },
        actor,
      }),
      ...moved,
    ];
  });
}

interface MoveOccupantsParams {
  readonly current: WorkflowStateRow;
  readonly occupants: readonly IssueRow[];
  readonly options: DeleteWorkflowStateOptions;
  readonly syncId: number;
  readonly actor: Actor;
  readonly principal: Principal;
}

async function moveOccupants(
  tx: Executor,
  params: MoveOccupantsParams,
): Promise<readonly SyncAction[]> {
  const target = await targetForMove(
    tx,
    params.current,
    params.options.moveToStateId,
    params.occupants.length,
  );
  const actions = await restateIssues(tx, {
    issues: params.occupants,
    stateId: target.id,
    category: target.category,
    syncId: params.syncId,
    actor: params.actor,
    moved: true,
  });
  await appendActivities(
    tx,
    params.occupants.map((issue) => ({
      organizationId: params.principal.organizationId,
      issueId: issue.id,
      actor: params.actor,
      field: 'stateId',
      from: params.current.name,
      to: target.name,
      syncId: params.syncId,
    })),
  );
  return actions;
}

export async function reorderWorkflowStates(
  principal: Principal,
  input: unknown,
): Promise<{ states: WorkflowStateRow[]; actions: SyncAction[] }> {
  assertCan(principal, 'workflow:manage');
  const parsed = workflowStateReorderSchema.parse(input);
  const wanted = [...new Set(parsed.stateIds)];
  if (wanted.length !== parsed.stateIds.length) {
    throw validationFailed('That order names the same status twice.');
  }

  return await db.transaction(async (tx) => {
    const team = await requireTeam(principal, parsed.teamId, tx);
    const existing = await tx
      .select()
      .from(schema.workflowState)
      .where(
        and(
          eq(schema.workflowState.organizationId, principal.organizationId),
          eq(schema.workflowState.teamId, team.id),
        ),
      );
    const known = new Set(existing.map((row) => row.id));
    if (existing.length !== wanted.length || wanted.some((id) => !known.has(id))) {
      throw conflict('Reordering needs every status on the team, exactly once.', {
        details: { teamId: team.id, expected: existing.length, received: wanted.length },
      });
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const states: WorkflowStateRow[] = [];
    for (const [position, id] of wanted.entries()) {
      const [updated] = await tx
        .update(schema.workflowState)
        .set({ position, syncId })
        .where(eq(schema.workflowState.id, id))
        .returning();
      if (updated !== undefined) states.push(updated);
    }

    return {
      states,
      actions: states.map((row) => stateAction(row, syncId, actor, 'update')),
    };
  });
}
