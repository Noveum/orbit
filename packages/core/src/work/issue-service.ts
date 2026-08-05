import { and, asc, count, db, desc, eq, ilike, inArray, isNull, or, schema, sql } from '@orbit/db';
import { type IssueRelationType, SORT_ORDER_STEP } from '@orbit/shared/constants';
import { conflict, notFound, validationFailed } from '@orbit/shared/errors';
import type { Actor, SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { UNSET_FILTER_VALUE } from '@orbit/shared/filters';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, assertInTeam, isInTeam, teamScope } from '@orbit/shared/policy';
import { issueIdentifier, parseIssueIdentifier, sortOrderBetween } from '@orbit/shared/utils';
import {
  issueBulkUpdateSchema,
  issueCreateSchema,
  issueFilterSchema,
  issueMoveSchema,
  issueRelationSchema,
  issueUpdateSchema,
  paginationSchema,
} from '@orbit/shared/validators';
import { getTableColumns, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { appendActivities, principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow, toDateString } from '../internal.ts';
import { requireTeam, type TeamRow } from '../org/team-service.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { buildFilterFilters, today } from './issue-predicates.ts';
import { initialStateFor } from './workflow-state-service.ts';

export type IssueRow = typeof schema.issue.$inferSelect;
export type IssueRelationRow = typeof schema.issueRelation.$inferSelect;
export type IssueValues = Partial<typeof schema.issue.$inferInsert>;

type GroupedMoveField = 'cycleId' | 'assigneeId' | 'priority' | 'projectId';

export const REBALANCE_THRESHOLD = 0.0001;

export const INVERSE_RELATION: Record<IssueRelationType, IssueRelationType> = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  related: 'related',
  duplicate_of: 'duplicated_by',
  duplicated_by: 'duplicate_of',
};

export const PARENT_CHAIN_LIMIT = 10;

async function assertParentAllowed(
  executor: Executor,
  organizationId: string,
  issueId: string,
  parentId: string,
): Promise<void> {
  let cursor: string | null = parentId;
  let depth = 0;
  while (cursor !== null) {
    if (cursor === issueId) {
      throw conflict('An issue cannot be its own parent, directly or through its parent chain.');
    }
    depth += 1;
    if (depth > PARENT_CHAIN_LIMIT) throw conflict('That parent chain is too deep.');
    const rows: { parentId: string | null }[] = await executor
      .select({ parentId: schema.issue.parentId })
      .from(schema.issue)
      .where(and(eq(schema.issue.id, cursor), eq(schema.issue.organizationId, organizationId)))
      .limit(1);
    const parent = requireRow(rows[0], 'That parent issue does not exist.');
    cursor = parent.parentId;
  }
}

export function issueScopes(
  row: Pick<IssueRow, 'organizationId' | 'teamId' | 'id' | 'projectId'>,
): string[] {
  const list = [scopes.team(row.teamId), scopes.issue(row.id)];
  if (row.projectId !== null) list.push(scopes.project(row.projectId));
  return list;
}

function issueAction(
  row: IssueRow,
  syncId: number,
  actor: Actor,
  action: 'insert' | 'update' | 'delete' | 'archive' | 'unarchive',
  labelIds?: readonly string[],
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: issueScopes(row),
    action,
    model: 'issue',
    modelId: row.id,
    data: labelIds === undefined ? row : { ...row, labelIds: [...labelIds] },
    actor,
  });
}

async function allocateIssueNumber(executor: Executor, team: TeamRow): Promise<number> {
  const [row] = await executor
    .update(schema.team)
    .set({ issueCounter: sql`${schema.team.issueCounter} + 1` })
    .where(and(eq(schema.team.id, team.id), eq(schema.team.organizationId, team.organizationId)))
    .returning({ issueCounter: schema.team.issueCounter });
  if (row === undefined) throw notFound('That team does not exist.');
  return row.issueCounter;
}

async function topOfColumn(executor: Executor, teamId: string, stateId: string): Promise<number> {
  const [row] = await executor
    .select({ sortOrder: schema.issue.sortOrder })
    .from(schema.issue)
    .where(and(eq(schema.issue.teamId, teamId), eq(schema.issue.stateId, stateId)))
    .orderBy(asc(schema.issue.sortOrder))
    .limit(1);
  return sortOrderBetween(null, row?.sortOrder ?? null);
}

async function stateOf(executor: Executor, stateId: string) {
  const [row] = await executor
    .select()
    .from(schema.workflowState)
    .where(eq(schema.workflowState.id, stateId))
    .limit(1);
  return requireRow(row, 'That status does not exist.');
}

export function stateTimestamps(category: string, now: Date): IssueValues {
  if (category === 'completed') {
    return { completedAt: now, canceledAt: null, stateEnteredAt: now };
  }
  if (category === 'canceled') {
    return { canceledAt: now, completedAt: null, stateEnteredAt: now };
  }
  if (category === 'started' || category === 'review') {
    return { startedAt: now, completedAt: null, canceledAt: null, stateEnteredAt: now };
  }
  return { startedAt: null, completedAt: null, canceledAt: null, stateEnteredAt: now };
}

function applyStateTimestamps(current: IssueRow, category: string, now: Date): IssueValues {
  const next = stateTimestamps(category, now);
  if ((category === 'started' || category === 'review') && current.startedAt !== null) {
    return { ...next, startedAt: current.startedAt };
  }
  if (category === 'completed') {
    return { ...next, startedAt: current.startedAt ?? now };
  }
  return next;
}

const NAME_LOADERS: Record<string, (executor: Executor, id: string) => Promise<string | null>> = {
  stateId: async (executor, id) => {
    const [row] = await executor
      .select({ name: schema.workflowState.name })
      .from(schema.workflowState)
      .where(eq(schema.workflowState.id, id))
      .limit(1);
    return row?.name ?? null;
  },
  assigneeId: async (executor, id) => {
    const [row] = await executor
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, id))
      .limit(1);
    return row?.name ?? null;
  },
  projectId: async (executor, id) => {
    const [row] = await executor
      .select({ name: schema.project.name })
      .from(schema.project)
      .where(eq(schema.project.id, id))
      .limit(1);
    return row?.name ?? null;
  },
  cycleId: async (executor, id) => {
    const [row] = await executor
      .select({ name: schema.cycle.name })
      .from(schema.cycle)
      .where(eq(schema.cycle.id, id))
      .limit(1);
    return row?.name ?? null;
  },
  milestoneId: async (executor, id) => {
    const [row] = await executor
      .select({ name: schema.milestone.name })
      .from(schema.milestone)
      .where(eq(schema.milestone.id, id))
      .limit(1);
    return row?.name ?? null;
  },
  parentId: async (executor, id) => {
    const [row] = await executor
      .select({ identifier: schema.issue.identifier })
      .from(schema.issue)
      .where(eq(schema.issue.id, id))
      .limit(1);
    return row?.identifier ?? null;
  },
};

async function describeValue(executor: Executor, field: string, value: unknown): Promise<unknown> {
  if (typeof value !== 'string') return value ?? null;
  const load = NAME_LOADERS[field];
  if (load === undefined) return value;
  const name = await load(executor, value);
  return name === null ? value : { id: value, name };
}

const BATCH_NAME_LOADERS: Record<
  string,
  (executor: Executor, ids: readonly string[]) => Promise<Map<string, string>>
> = {
  stateId: async (executor, ids) =>
    await namesOf(
      executor
        .select({ id: schema.workflowState.id, name: schema.workflowState.name })
        .from(schema.workflowState)
        .where(inArray(schema.workflowState.id, [...ids])),
    ),
  assigneeId: async (executor, ids) =>
    await namesOf(
      executor
        .select({ id: schema.user.id, name: schema.user.name })
        .from(schema.user)
        .where(inArray(schema.user.id, [...ids])),
    ),
  projectId: async (executor, ids) =>
    await namesOf(
      executor
        .select({ id: schema.project.id, name: schema.project.name })
        .from(schema.project)
        .where(inArray(schema.project.id, [...ids])),
    ),
  cycleId: async (executor, ids) =>
    await namesOf(
      executor
        .select({ id: schema.cycle.id, name: schema.cycle.name })
        .from(schema.cycle)
        .where(inArray(schema.cycle.id, [...ids])),
    ),
  milestoneId: async (executor, ids) =>
    await namesOf(
      executor
        .select({ id: schema.milestone.id, name: schema.milestone.name })
        .from(schema.milestone)
        .where(inArray(schema.milestone.id, [...ids])),
    ),
  parentId: async (executor, ids) =>
    await namesOf(
      executor
        .select({ id: schema.issue.id, name: schema.issue.identifier })
        .from(schema.issue)
        .where(inArray(schema.issue.id, [...ids])),
    ),
};

async function namesOf(
  query: Promise<{ id: string; name: string }[]>,
): Promise<Map<string, string>> {
  return new Map((await query).map((row) => [row.id, row.name]));
}

interface FieldChange {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

async function describeChanges(
  executor: Executor,
  changes: readonly FieldChange[],
): Promise<Map<string, unknown>> {
  const wanted = new Map<string, Set<string>>();
  for (const change of changes) {
    if (BATCH_NAME_LOADERS[change.field] === undefined) continue;
    const bucket = wanted.get(change.field) ?? new Set<string>();
    for (const value of [change.from, change.to]) {
      if (typeof value === 'string') bucket.add(value);
    }
    wanted.set(change.field, bucket);
  }

  const described = new Map<string, unknown>();
  for (const [field, ids] of wanted) {
    const load = BATCH_NAME_LOADERS[field];
    if (load === undefined || ids.size === 0) continue;
    const names = await load(executor, [...ids]);
    for (const id of ids) {
      const name = names.get(id);
      described.set(`${field}:${id}`, name === undefined ? id : { id, name });
    }
  }
  return described;
}

function describedValue(
  described: ReadonlyMap<string, unknown>,
  field: string,
  value: unknown,
): unknown {
  if (typeof value !== 'string') return value ?? null;
  return described.get(`${field}:${value}`) ?? value;
}

function collectIssueChanges(
  current: IssueRow,
  patch: ReturnType<typeof issueUpdateSchema.parse>,
): { values: IssueValues; changes: FieldChange[] } {
  const values: IssueValues = {};
  const changes: FieldChange[] = [];

  const track = <K extends keyof typeof schema.issue.$inferInsert>(
    field: K,
    next: (typeof schema.issue.$inferInsert)[K] | undefined,
  ): void => {
    if (next === undefined) return;
    const from = current[field];
    if (Object.is(next, from)) return;
    values[field] = next;
    changes.push({ field, from, to: next });
  };

  track('title', patch.title);
  track('description', patch.description);
  track('stateId', patch.stateId);
  track('priority', patch.priority);
  track('assigneeId', patch.assigneeId);
  track('projectId', patch.projectId);
  track('milestoneId', patch.milestoneId);
  track('cycleId', patch.cycleId);
  track('parentId', patch.parentId);
  track('estimate', patch.estimate);
  track('dueDate', toDateString(patch.dueDate));
  track('sortOrder', patch.sortOrder);

  return { values, changes };
}

async function loadIssue(
  executor: Executor,
  principal: Principal,
  issueId: string,
): Promise<IssueRow> {
  const [row] = await executor
    .select()
    .from(schema.issue)
    .where(
      and(eq(schema.issue.id, issueId), eq(schema.issue.organizationId, principal.organizationId)),
    )
    .limit(1);
  const issue = requireRow(row, 'That issue does not exist.');
  if (!isInTeam(principal, teamScope(issue))) throw notFound('That issue does not exist.');
  return issue;
}

async function labelsByIssue(
  executor: Executor,
  issueIds: readonly string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  const ids = [...new Set(issueIds)];
  if (ids.length === 0) return grouped;
  const rows = await executor
    .select({ issueId: schema.issueLabel.issueId, labelId: schema.issueLabel.labelId })
    .from(schema.issueLabel)
    .where(inArray(schema.issueLabel.issueId, ids));
  for (const row of rows) {
    const existing = grouped.get(row.issueId);
    if (existing === undefined) grouped.set(row.issueId, [row.labelId]);
    else existing.push(row.labelId);
  }
  return grouped;
}

async function replaceLabelsFor(
  executor: Executor,
  issueIds: readonly string[],
  labelIds: readonly string[],
): Promise<void> {
  if (issueIds.length === 0) return;
  await executor.delete(schema.issueLabel).where(inArray(schema.issueLabel.issueId, [...issueIds]));
  const unique = [...new Set(labelIds)];
  if (unique.length === 0) return;
  await executor
    .insert(schema.issueLabel)
    .values(
      issueIds.flatMap((issueId) => unique.map((labelId) => ({ id: newId(), issueId, labelId }))),
    )
    .onConflictDoNothing();
}

async function replaceLabels(
  executor: Executor,
  issueId: string,
  labelIds: readonly string[],
): Promise<void> {
  await replaceLabelsFor(executor, [issueId], labelIds);
}

async function subscribeToIssues(
  executor: Executor,
  pairs: readonly { issueId: string; userId: string | null }[],
): Promise<void> {
  const rows = pairs.flatMap((pair) =>
    pair.userId === null ? [] : [{ id: newId(), issueId: pair.issueId, userId: pair.userId }],
  );
  if (rows.length === 0) return;
  await executor.insert(schema.issueSubscription).values(rows).onConflictDoNothing();
}

async function subscribeUsers(
  executor: Executor,
  issueId: string,
  userIds: readonly (string | null)[],
  syncId: number,
): Promise<void> {
  const unique = [...new Set(userIds.filter((id): id is string => id !== null))];
  if (unique.length === 0) return;
  await executor
    .insert(schema.issueSubscription)
    .values(unique.map((userId) => ({ id: newId(), issueId, userId, syncId })))
    .onConflictDoUpdate({
      target: [schema.issueSubscription.issueId, schema.issueSubscription.userId],
      set: { syncId },
    });
}

export interface CreatedIssue {
  readonly issue: IssueRow;
  readonly actions: SyncAction[];
}

async function assertCycleInTeam(
  executor: Executor,
  organizationId: string,
  teamId: string,
  cycleId: string,
): Promise<void> {
  const [row] = await executor
    .select({ teamId: schema.cycle.teamId, organizationId: schema.cycle.organizationId })
    .from(schema.cycle)
    .where(eq(schema.cycle.id, cycleId))
    .limit(1);
  const cycle = requireRow(row, 'That sprint does not exist.');
  if (cycle.organizationId !== organizationId || cycle.teamId !== teamId) {
    throw validationFailed('That sprint belongs to another team.');
  }
}

async function projectTeamIds(executor: Executor, projectId: string): Promise<string[]> {
  const rows = await executor
    .select({ teamId: schema.projectTeam.teamId })
    .from(schema.projectTeam)
    .where(eq(schema.projectTeam.projectId, projectId));
  return rows.map((row) => row.teamId);
}

async function assertProjectInTeam(
  executor: Executor,
  organizationId: string,
  teamId: string,
  projectId: string,
): Promise<void> {
  const [row] = await executor
    .select({ organizationId: schema.project.organizationId })
    .from(schema.project)
    .where(eq(schema.project.id, projectId))
    .limit(1);
  const project = requireRow(row, 'That project does not exist.');
  if (project.organizationId !== organizationId) {
    throw validationFailed('That project belongs to another workspace.');
  }
  const teams = await projectTeamIds(executor, projectId);
  if (teams.length > 0 && !teams.includes(teamId)) {
    throw validationFailed('That project belongs to another team.');
  }
}

async function assertMilestoneInTeam(
  executor: Executor,
  organizationId: string,
  teamId: string,
  milestoneId: string,
  projectId: string | null | undefined,
): Promise<void> {
  const [row] = await executor
    .select({
      organizationId: schema.milestone.organizationId,
      projectId: schema.milestone.projectId,
    })
    .from(schema.milestone)
    .where(eq(schema.milestone.id, milestoneId))
    .limit(1);
  const milestone = requireRow(row, 'That milestone does not exist.');
  if (milestone.organizationId !== organizationId) {
    throw validationFailed('That milestone belongs to another workspace.');
  }
  if (projectId !== undefined && projectId !== null && projectId !== milestone.projectId) {
    throw validationFailed('That milestone belongs to another project.');
  }
  const teams = await projectTeamIds(executor, milestone.projectId);
  if (teams.length > 0 && !teams.includes(teamId)) {
    throw validationFailed('That milestone belongs to another team.');
  }
}

async function projectFitsTeam(
  executor: Executor,
  teamId: string,
  projectId: string | null,
): Promise<boolean> {
  if (projectId === null) return false;
  const rows = await executor
    .select({ teamId: schema.projectTeam.teamId })
    .from(schema.projectTeam)
    .where(eq(schema.projectTeam.projectId, projectId));
  if (rows.length === 0) return true;
  return rows.some((row) => row.teamId === teamId);
}

async function assertAssignableToTeam(
  executor: Executor,
  organizationId: string,
  teamId: string,
  values: Pick<IssueValues, 'cycleId' | 'projectId' | 'milestoneId'>,
): Promise<void> {
  const { cycleId, projectId, milestoneId } = values;
  if (cycleId !== undefined && cycleId !== null) {
    await assertCycleInTeam(executor, organizationId, teamId, cycleId);
  }
  if (projectId !== undefined && projectId !== null) {
    await assertProjectInTeam(executor, organizationId, teamId, projectId);
  }
  if (milestoneId !== undefined && milestoneId !== null) {
    await assertMilestoneInTeam(executor, organizationId, teamId, milestoneId, projectId);
  }
}

export async function createIssue(principal: Principal, input: unknown): Promise<CreatedIssue> {
  assertCan(principal, 'issue:create');
  const parsed = issueCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const team = await requireTeam(principal, parsed.teamId, tx);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const state =
      parsed.stateId === undefined
        ? await initialStateFor(tx, team.id)
        : await stateOf(tx, parsed.stateId);
    if (state.teamId !== team.id) {
      throw validationFailed('That status belongs to another team.');
    }
    await assertAssignableToTeam(tx, principal.organizationId, team.id, {
      cycleId: parsed.cycleId,
      projectId: parsed.projectId,
      milestoneId: parsed.milestoneId,
    });

    const number = await allocateIssueNumber(tx, team);
    const now = new Date();
    const id = newId();
    if (parsed.parentId !== null) {
      await assertParentAllowed(tx, principal.organizationId, id, parsed.parentId);
    }

    const [created] = await tx
      .insert(schema.issue)
      .values({
        id,
        organizationId: principal.organizationId,
        teamId: team.id,
        number,
        identifier: issueIdentifier(team.key, number),
        title: parsed.title,
        description: parsed.description,
        stateId: state.id,
        priority: parsed.priority,
        creatorId: principal.userId,
        assigneeId: parsed.assigneeId,
        projectId: parsed.projectId,
        milestoneId: parsed.milestoneId,
        cycleId: parsed.cycleId,
        parentId: parsed.parentId,
        estimate: parsed.estimate,
        dueDate: toDateString(parsed.dueDate) ?? null,
        sortOrder: await topOfColumn(tx, team.id, state.id),
        ...stateTimestamps(state.category, now),
        syncId,
      })
      .returning();
    const issue = requireRow(created, 'The issue could not be created.');

    await replaceLabels(tx, issue.id, parsed.labelIds);
    await subscribeUsers(tx, issue.id, [principal.userId, parsed.assigneeId], syncId);
    await appendActivities(tx, [
      {
        organizationId: principal.organizationId,
        issueId: issue.id,
        actor,
        field: 'created',
        from: null,
        to: { id: state.id, name: state.name },
        syncId,
      },
    ]);

    return { issue, actions: [issueAction(issue, syncId, actor, 'insert', parsed.labelIds)] };
  });
}

export interface UpdatedIssue {
  readonly issue: IssueRow;
  readonly changes: FieldChange[];
  readonly actions: SyncAction[];
}

interface PendingUpdate {
  readonly current: IssueRow;
  readonly values: IssueValues;
  readonly changes: FieldChange[];
}

async function loadIssues(
  executor: Executor,
  organizationId: string,
  issueIds: readonly string[],
): Promise<Map<string, IssueRow>> {
  const rows = await executor
    .select()
    .from(schema.issue)
    .where(
      and(inArray(schema.issue.id, [...issueIds]), eq(schema.issue.organizationId, organizationId)),
    );
  return new Map(rows.map((row) => [row.id, row]));
}

function updateGroups(pending: readonly PendingUpdate[]): Map<string, PendingUpdate[]> {
  const groups = new Map<string, PendingUpdate[]>();
  for (const entry of pending) {
    const key = JSON.stringify(Object.entries(entry.values).sort());
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }
  return groups;
}

async function applyIssueUpdates(
  tx: Executor,
  principal: Principal,
  issueIds: readonly string[],
  parsed: ReturnType<typeof issueUpdateSchema.parse>,
): Promise<UpdatedIssue[]> {
  const loaded = await loadIssues(tx, principal.organizationId, issueIds);
  const now = new Date();
  const state = parsed.stateId === undefined ? null : await stateOf(tx, parsed.stateId);

  const pending: PendingUpdate[] = [];
  for (const issueId of issueIds) {
    const current = requireRow(loaded.get(issueId), 'That issue does not exist.');
    assertInTeam(principal, teamScope(current));

    const { values, changes } = collectIssueChanges(current, parsed);
    if (values.parentId !== undefined && values.parentId !== null) {
      await assertParentAllowed(tx, principal.organizationId, current.id, values.parentId);
    }
    if (values.stateId !== undefined) {
      if (state === null || state.teamId !== current.teamId) {
        throw validationFailed('That status belongs to another team.');
      }
      Object.assign(values, applyStateTimestamps(current, state.category, now));
    }
    await assertAssignableToTeam(tx, principal.organizationId, current.teamId, values);
    pending.push({ current, values, changes });
  }

  const labelsChanged = parsed.labelIds !== undefined;
  const changing = pending.filter((entry) => entry.changes.length > 0 || labelsChanged);
  if (changing.length === 0) {
    return pending.map((entry) => ({ issue: entry.current, changes: [], actions: [] }));
  }

  const syncId = await nextSyncId(tx);
  const actor = await principalActor(tx, principal);

  const updated = new Map<string, IssueRow>();
  for (const [, group] of updateGroups(changing)) {
    const first = group[0];
    if (first === undefined) continue;
    const rows = await tx
      .update(schema.issue)
      .set({ ...first.values, updatedAt: now, syncId })
      .where(
        inArray(
          schema.issue.id,
          group.map((entry) => entry.current.id),
        ),
      )
      .returning();
    for (const row of rows) updated.set(row.id, row);
  }

  if (parsed.labelIds !== undefined) {
    await replaceLabelsFor(
      tx,
      changing.map((entry) => entry.current.id),
      parsed.labelIds,
    );
  }

  const assigned = changing
    .filter((entry) => entry.values.assigneeId !== undefined)
    .map((entry) => ({ issueId: entry.current.id, userId: entry.values.assigneeId ?? null }));
  await subscribeToIssues(tx, assigned);

  const described = await describeChanges(
    tx,
    changing.flatMap((entry) => entry.changes),
  );
  await appendActivities(
    tx,
    changing.flatMap((entry) =>
      entry.changes.map((change) => ({
        organizationId: principal.organizationId,
        issueId: entry.current.id,
        actor,
        field: change.field,
        from: describedValue(described, change.field, change.from),
        to: describedValue(described, change.field, change.to),
        syncId,
      })),
    ),
  );

  const labels = await labelsByIssue(
    tx,
    pending.map((entry) => entry.current.id),
  );

  return pending.map((entry) => {
    const issue = updated.get(entry.current.id);
    if (issue === undefined) return { issue: entry.current, changes: [], actions: [] };
    return {
      issue,
      changes: entry.changes,
      actions: [issueAction(issue, syncId, actor, 'update', labels.get(issue.id) ?? [])],
    };
  });
}

async function applyIssueUpdate(
  tx: Executor,
  principal: Principal,
  issueId: string,
  parsed: ReturnType<typeof issueUpdateSchema.parse>,
): Promise<UpdatedIssue> {
  const [result] = await applyIssueUpdates(tx, principal, [issueId], parsed);
  return requireRow(result, 'That issue does not exist.');
}

export async function updateIssue(
  principal: Principal,
  issueId: string,
  patch: unknown,
): Promise<UpdatedIssue> {
  assertCan(principal, 'issue:update');
  const parsed = issueUpdateSchema.parse(patch);
  return await db.transaction(async (tx) => applyIssueUpdate(tx, principal, issueId, parsed));
}

async function orderOf(executor: Executor, issueId: string | null): Promise<number | null> {
  if (issueId === null) return null;
  const [row] = await executor
    .select({ sortOrder: schema.issue.sortOrder })
    .from(schema.issue)
    .where(eq(schema.issue.id, issueId))
    .limit(1);
  return row?.sortOrder ?? null;
}

export async function rebalanceColumn(
  executor: Executor,
  teamId: string,
  stateId: string,
  syncId: number,
): Promise<IssueRow[]> {
  const rows = await executor
    .select({ id: schema.issue.id })
    .from(schema.issue)
    .where(and(eq(schema.issue.teamId, teamId), eq(schema.issue.stateId, stateId)))
    .orderBy(asc(schema.issue.sortOrder), asc(schema.issue.createdAt));

  const updated: IssueRow[] = [];
  for (const [index, row] of rows.entries()) {
    const [next] = await executor
      .update(schema.issue)
      .set({ sortOrder: (index + 1) * SORT_ORDER_STEP, syncId })
      .where(eq(schema.issue.id, row.id))
      .returning();
    if (next !== undefined) updated.push(next);
  }
  return updated;
}

export interface MovedIssue {
  readonly issue: IssueRow;
  readonly rebalanced: IssueRow[];
  readonly actions: SyncAction[];
}

interface RegroupingInput {
  readonly cycleId?: string | null | undefined;
  readonly assigneeId?: string | null | undefined;
  readonly priority?: number | undefined;
  readonly projectId?: string | null | undefined;
}

function applyRegrouping(
  parsed: RegroupingInput,
  current: IssueRow,
  values: IssueValues,
): GroupedMoveField[] {
  const regrouped: GroupedMoveField[] = [];
  const regroup = <Field extends GroupedMoveField>(
    field: Field,
    next: IssueValues[Field] | undefined,
  ): void => {
    if (next === undefined || next === current[field]) return;
    values[field] = next;
    regrouped.push(field);
  };
  regroup('cycleId', parsed.cycleId);
  regroup('assigneeId', parsed.assigneeId);
  regroup('priority', parsed.priority);
  if (parsed.projectId !== undefined && parsed.projectId !== current.projectId) {
    regroup('projectId', parsed.projectId);
    values.milestoneId = null;
  }
  return regrouped;
}

interface RegroupActivityInput {
  readonly organizationId: string;
  readonly issueId: string;
  readonly actor: Actor;
  readonly syncId: number;
  readonly regrouped: readonly GroupedMoveField[];
  readonly current: IssueRow;
  readonly issue: IssueRow;
}

async function recordRegroupings(tx: Executor, input: RegroupActivityInput): Promise<void> {
  for (const field of input.regrouped) {
    await appendActivities(tx, [
      {
        organizationId: input.organizationId,
        issueId: input.issueId,
        actor: input.actor,
        field,
        from: await describeValue(tx, field, input.current[field]),
        to: await describeValue(tx, field, input.issue[field]),
        syncId: input.syncId,
      },
    ]);
  }
}

export async function moveIssue(
  principal: Principal,
  issueId: string,
  input: unknown,
): Promise<MovedIssue> {
  assertCan(principal, 'issue:update');
  const parsed = issueMoveSchema.parse(input);

  return await db.transaction(async (tx) => {
    const current = await loadIssue(tx, principal, issueId);

    const team = await requireTeam(principal, parsed.teamId ?? current.teamId, tx);
    const teamId = team.id;
    const state =
      parsed.stateId === undefined
        ? await stateOf(tx, current.stateId)
        : await stateOf(tx, parsed.stateId);
    if (state.teamId !== teamId) throw validationFailed('That status belongs to another team.');

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);

    let before = await orderOf(tx, parsed.beforeId);
    let after = await orderOf(tx, parsed.afterId);
    let rebalanced: IssueRow[] = [];
    if (before !== null && after !== null && Math.abs(after - before) < REBALANCE_THRESHOLD) {
      rebalanced = await rebalanceColumn(tx, teamId, state.id, syncId);
      before = await orderOf(tx, parsed.beforeId);
      after = await orderOf(tx, parsed.afterId);
    }

    const now = new Date();
    const values: IssueValues = { sortOrder: sortOrderBetween(before, after) };
    if (teamId !== current.teamId) {
      const number = await allocateIssueNumber(tx, team);
      values.teamId = teamId;
      values.number = number;
      values.identifier = issueIdentifier(team.key, number);
      values.cycleId = null;
      if (!(await projectFitsTeam(tx, teamId, current.projectId))) {
        values.projectId = null;
        values.milestoneId = null;
      }
    }
    if (state.id !== current.stateId) {
      values.stateId = state.id;
      Object.assign(values, applyStateTimestamps(current, state.category, now));
    }

    await assertAssignableToTeam(tx, principal.organizationId, teamId, {
      cycleId: parsed.cycleId,
      projectId: parsed.projectId,
    });

    const regrouped = applyRegrouping(parsed, current, values);

    const [moved] = await tx
      .update(schema.issue)
      .set({ ...values, updatedAt: now, syncId })
      .where(eq(schema.issue.id, issueId))
      .returning();
    const issue = requireRow(moved, 'That issue does not exist.');

    if (state.id !== current.stateId) {
      await appendActivities(tx, [
        {
          organizationId: principal.organizationId,
          issueId,
          actor,
          field: 'stateId',
          from: await describeValue(tx, 'stateId', current.stateId),
          to: { id: state.id, name: state.name },
          syncId,
        },
      ]);
    }

    await recordRegroupings(tx, {
      organizationId: principal.organizationId,
      issueId,
      actor,
      syncId,
      regrouped,
      current,
      issue,
    });

    const movedLabels = await labelsByIssue(tx, [issue.id, ...rebalanced.map((row) => row.id)]);

    return {
      issue,
      rebalanced,
      actions: [
        issueAction(issue, syncId, actor, 'update', movedLabels.get(issue.id) ?? []),
        ...rebalanced
          .filter((row) => row.id !== issueId)
          .map((row) => issueAction(row, syncId, actor, 'update', movedLabels.get(row.id) ?? [])),
      ],
    };
  });
}

export async function bulkUpdateIssues(
  principal: Principal,
  input: unknown,
): Promise<{ issues: IssueRow[]; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const parsed = issueBulkUpdateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const results = await applyIssueUpdates(
      tx,
      principal,
      [...new Set(parsed.issueIds)],
      parsed.patch,
    );
    return {
      issues: results.map((result) => result.issue),
      actions: results.flatMap((result) => result.actions),
    };
  });
}

async function setArchived(
  principal: Principal,
  issueId: string,
  archivedAt: Date | null,
): Promise<{ issue: IssueRow; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');

  return await db.transaction(async (tx) => {
    await loadIssue(tx, principal, issueId);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.issue)
      .set({ archivedAt, updatedAt: new Date(), syncId })
      .where(eq(schema.issue.id, issueId))
      .returning();
    const issue = requireRow(updated, 'That issue does not exist.');

    await appendActivities(tx, [
      {
        organizationId: principal.organizationId,
        issueId,
        actor,
        field: archivedAt === null ? 'unarchived' : 'archived',
        from: null,
        to: null,
        syncId,
      },
    ]);

    return {
      issue,
      actions: [
        issueAction(
          issue,
          syncId,
          actor,
          archivedAt === null ? 'unarchive' : 'archive',
          (await labelsByIssue(tx, [issue.id])).get(issue.id) ?? [],
        ),
      ],
    };
  });
}

export async function archiveIssue(
  principal: Principal,
  issueId: string,
): Promise<{ issue: IssueRow; actions: SyncAction[] }> {
  return await setArchived(principal, issueId, new Date());
}

export async function unarchiveIssue(
  principal: Principal,
  issueId: string,
): Promise<{ issue: IssueRow; actions: SyncAction[] }> {
  return await setArchived(principal, issueId, null);
}

export async function deleteIssue(principal: Principal, issueId: string): Promise<SyncAction[]> {
  assertCan(principal, 'issue:delete');

  return await db.transaction(async (tx) => {
    const current = await loadIssue(tx, principal, issueId);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx.update(schema.issue).set({ parentId: null }).where(eq(schema.issue.parentId, issueId));
    await tx.delete(schema.issue).where(eq(schema.issue.id, issueId));

    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: issueScopes(current),
        action: 'delete',
        model: 'issue',
        modelId: issueId,
        data: { id: issueId, teamId: current.teamId, identifier: current.identifier },
        actor,
      }),
    ];
  });
}

const issueListSchema = issueFilterSchema
  .extend(paginationSchema.shape)
  .extend({ select: z.enum(['list', 'full']).default('list') });
export type IssueListInput = typeof issueListSchema;

const ISSUE_COLUMNS = getTableColumns(schema.issue);

const {
  description: _description,
  organizationId: _organizationId,
  stateEnteredAt: _stateEnteredAt,
  estimatePointId: _estimatePointId,
  ...ISSUE_LIST_COLUMNS
} = ISSUE_COLUMNS;

function visibleTeamFilters(principal: Principal): SQL[] {
  if (principal.role === 'admin') return [];
  if (principal.teamIds.length === 0) return [sql`false`];
  return [inArray(schema.issue.teamId, [...principal.teamIds])];
}

function buildScopeFilters(
  principal: Principal,
  filter: ReturnType<typeof issueListSchema.parse>,
): SQL[] {
  const organizationId = principal.organizationId;
  const filters: SQL[] = [
    eq(schema.issue.organizationId, organizationId),
    ...visibleTeamFilters(principal),
  ];
  if (filter.teamId !== undefined) filters.push(eq(schema.issue.teamId, filter.teamId));
  if (filter.projectId !== undefined) filters.push(eq(schema.issue.projectId, filter.projectId));
  if (filter.cycleId !== undefined) filters.push(eq(schema.issue.cycleId, filter.cycleId));
  if (filter.milestoneId !== undefined) {
    filters.push(eq(schema.issue.milestoneId, filter.milestoneId));
  }
  if (filter.assigneeId !== undefined) filters.push(eq(schema.issue.assigneeId, filter.assigneeId));
  if (filter.stateId !== undefined) filters.push(eq(schema.issue.stateId, filter.stateId));
  if (filter.parentId !== undefined) filters.push(eq(schema.issue.parentId, filter.parentId));
  if (filter.stateCategory !== undefined) {
    filters.push(
      inArray(
        schema.issue.stateId,
        db
          .select({ id: schema.workflowState.id })
          .from(schema.workflowState)
          .where(
            and(
              eq(schema.workflowState.organizationId, organizationId),
              eq(schema.workflowState.category, filter.stateCategory),
            ),
          ),
      ),
    );
  }
  if (filter.labelId !== undefined) {
    filters.push(
      inArray(
        schema.issue.id,
        db
          .select({ id: schema.issueLabel.issueId })
          .from(schema.issueLabel)
          .where(eq(schema.issueLabel.labelId, filter.labelId)),
      ),
    );
  }
  if (filter.query !== undefined && filter.query.trim().length > 0) {
    const term = `%${filter.query.trim()}%`;
    const matches = or(
      ilike(schema.issue.title, term),
      ilike(schema.issue.description, term),
      ilike(schema.issue.identifier, term),
    );
    if (matches !== undefined) filters.push(matches);
  }
  if (!filter.includeArchived) filters.push(isNull(schema.issue.archivedAt));
  if (!filter.includeSubIssues && filter.parentId === undefined) {
    filters.push(isNull(schema.issue.parentId));
  }
  return filters;
}

function buildIssueFilters(
  principal: Principal,
  filter: ReturnType<typeof issueListSchema.parse>,
): SQL[] {
  return [
    ...buildScopeFilters(principal, filter),
    ...buildFilterFilters(filter.filter, { today: today() }),
  ];
}

type OrderKey = ReturnType<typeof issueListSchema.parse>['orderBy'];

const ORDERINGS: Record<
  OrderKey,
  {
    expression: SQL;
    descending: boolean;
    cast: string;
    read: (row: IssueListRow) => string | number;
  }
> = {
  manual: {
    expression: sql`${schema.issue.sortOrder}`,
    descending: false,
    cast: 'double precision',
    read: (row) => row.sortOrder,
  },
  priority: {
    expression: sql`case when ${schema.issue.priority} = 0 then 5 else ${schema.issue.priority} end`,
    descending: false,
    cast: 'int',
    read: (row) => (row.priority === 0 ? 5 : row.priority),
  },
  created: {
    expression: sql`${schema.issue.createdAt}`,
    descending: true,
    cast: 'timestamptz',
    read: (row) => row.createdAt.toISOString(),
  },
  updated: {
    expression: sql`${schema.issue.updatedAt}`,
    descending: true,
    cast: 'timestamptz',
    read: (row) => row.updatedAt.toISOString(),
  },
  due: {
    expression: sql`coalesce(${schema.issue.dueDate}, '9999-12-31')`,
    descending: false,
    cast: 'date',
    read: (row) => row.dueDate ?? '9999-12-31',
  },
  estimate: {
    expression: sql`coalesce(${schema.issue.estimate}, 9999)`,
    descending: false,
    cast: 'int',
    read: (row) => row.estimate ?? 9999,
  },
  title: {
    expression: sql`lower(${schema.issue.title})`,
    descending: false,
    cast: 'text',
    read: (row) => row.title.toLowerCase(),
  },
};

function encodeCursor(value: string | number, id: string): string {
  return Buffer.from(JSON.stringify([value, id]), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { value: string | number; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('bad cursor');
    const [value, id] = parsed as [string | number, string];
    return { value, id };
  } catch (cause) {
    throw validationFailed('That page cursor is not valid.', { cause });
  }
}

export type TrimmedIssueColumn =
  | 'organizationId'
  | 'description'
  | 'estimatePointId'
  | 'stateEnteredAt';

export type IssueListRow = Omit<IssueRow, TrimmedIssueColumn> &
  Partial<Pick<IssueRow, TrimmedIssueColumn>>;

export interface IssuePage {
  readonly issues: IssueListRow[];
  readonly nextCursor: string | null;
}

export async function listIssues(principal: Principal, input: unknown = {}): Promise<IssuePage> {
  assertCan(principal, 'issue:read');
  const filter = issueListSchema.parse(input);
  const ordering = ORDERINGS[filter.orderBy];
  const filters = buildIssueFilters(principal, filter);

  if (filter.cursor !== undefined) {
    const { value, id } = decodeCursor(filter.cursor);
    const comparison = ordering.descending ? sql`<` : sql`>`;
    filters.push(
      sql`(${ordering.expression}, ${schema.issue.id}) ${comparison} (cast(${value} as ${sql.raw(ordering.cast)}), ${id})`,
    );
  }

  const direction = ordering.descending ? desc : asc;
  const rows = await db
    .select(filter.select === 'full' ? ISSUE_COLUMNS : ISSUE_LIST_COLUMNS)
    .from(schema.issue)
    .where(and(...filters))
    .orderBy(direction(ordering.expression), direction(schema.issue.id))
    .limit(filter.limit + 1);

  const page = rows.slice(0, filter.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > filter.limit && last !== undefined
      ? encodeCursor(ordering.read(last), last.id)
      : null;
  return { issues: page, nextCursor };
}

export async function getIssueCounts(
  principal: Principal,
  input: unknown = {},
): Promise<{ stateId: string; total: number }[]> {
  assertCan(principal, 'issue:read');
  const filter = issueListSchema.parse(input);
  const filters = buildIssueFilters(principal, filter);
  return await db
    .select({ stateId: schema.issue.stateId, total: count() })
    .from(schema.issue)
    .where(and(...filters))
    .groupBy(schema.issue.stateId);
}

export const FACET_PROPERTIES = [
  'state',
  'assignee',
  'creator',
  'priority',
  'estimate',
  'label',
  'project',
  'cycle',
  'milestone',
] as const;

export type FacetProperty = (typeof FACET_PROPERTIES)[number];

export type FacetCounts = Record<FacetProperty, Record<string, number>>;

export interface IssueSummary {
  readonly total: number;
  readonly byState: Record<string, number>;
  readonly groupTotals: Record<string, number>;
}

export interface IssueFacets {
  readonly scopeTotal: number;
  readonly facets: FacetCounts;
}

const UNSET_FACET_VALUE = UNSET_FILTER_VALUE;

type FacetTally = Record<string, number>;

function tally(rows: readonly { key: string | null; total: number }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.key ?? UNSET_FACET_VALUE] = Number(row.total);
  return counts;
}

async function facetOf(column: PgColumn, where: SQL | undefined): Promise<Record<string, number>> {
  const rows = await db
    .select({ key: sql<string | null>`${column}::text`, total: count() })
    .from(schema.issue)
    .where(where)
    .groupBy(column);
  return tally(rows);
}

async function labelFacet(where: SQL | undefined): Promise<Record<string, number>> {
  const [tagged, untagged] = await Promise.all([
    db
      .select({ key: sql<string | null>`${schema.issueLabel.labelId}`, total: count() })
      .from(schema.issue)
      .innerJoin(schema.issueLabel, eq(schema.issueLabel.issueId, schema.issue.id))
      .where(where)
      .groupBy(schema.issueLabel.labelId),
    db
      .select({ total: count() })
      .from(schema.issue)
      .where(
        and(
          where,
          sql`not exists (select 1 from ${schema.issueLabel} where ${schema.issueLabel.issueId} = ${schema.issue.id})`,
        ),
      ),
  ]);
  const counts = tally(tagged);
  const none = Number(untagged[0]?.total ?? 0);
  if (none > 0) counts[UNSET_FACET_VALUE] = none;
  return counts;
}

async function milestoneFacet(where: SQL | undefined): Promise<Record<string, number>> {
  const rows = await db
    .select({
      key: sql<string>`case when ${schema.issue.milestoneId} is null then ${UNSET_FACET_VALUE} else 'any' end`,
      total: count(),
    })
    .from(schema.issue)
    .where(where)
    .groupBy(sql`1`);
  return tally(rows);
}

const FACET_COLUMNS: Record<Exclude<FacetProperty, 'label' | 'milestone'>, () => PgColumn> = {
  state: () => schema.issue.stateId,
  assignee: () => schema.issue.assigneeId,
  creator: () => schema.issue.creatorId,
  priority: () => schema.issue.priority,
  estimate: () => schema.issue.estimate,
  project: () => schema.issue.projectId,
  cycle: () => schema.issue.cycleId,
};

const COLUMN_FACETS = [
  'state',
  'assignee',
  'creator',
  'priority',
  'estimate',
  'project',
  'cycle',
] as const;

type ColumnFacet = (typeof COLUMN_FACETS)[number];

type GroupingSetRow = {
  property: string;
  key: string | null;
  total: number;
};

export function columnFacetsSql(where: SQL | undefined): SQL {
  const columns = COLUMN_FACETS.map((property) => FACET_COLUMNS[property]());
  const grouping = sql.join(
    COLUMN_FACETS.map(
      (property, index) => sql`when grouping(${columns[index]}) = 0 then ${property}::text`,
    ),
    sql` `,
  );
  const sets = sql.join(
    columns.map((column) => sql`(${column})`),
    sql`, `,
  );
  const value = sql.join(
    columns.map((column) => sql`${column}::text`),
    sql`, `,
  );
  return sql`
    select
      case ${grouping} else 'unknown' end as property,
      coalesce(${value}) as key,
      count(*)::int as total
    from ${schema.issue}
    ${where === undefined ? sql`` : sql`where ${where}`}
    group by grouping sets (${sets})
  `;
}

async function columnFacets(where: SQL | undefined): Promise<Record<ColumnFacet, FacetTally>> {
  const rows = await db.execute<GroupingSetRow>(columnFacetsSql(where));
  const counts = {} as Record<ColumnFacet, FacetTally>;
  for (const property of COLUMN_FACETS) counts[property] = {};
  for (const row of rows) {
    const bucket = counts[row.property as ColumnFacet];
    if (bucket === undefined) continue;
    bucket[row.key ?? UNSET_FACET_VALUE] = Number(row.total);
  }
  return counts;
}

async function allFacets(where: SQL | undefined): Promise<FacetCounts> {
  const [columns, label, milestone] = await Promise.all([
    columnFacets(where),
    labelFacet(where),
    milestoneFacet(where),
  ]);
  return { ...columns, label, milestone };
}

function facetFor(
  property: FacetProperty,
  where: SQL | undefined,
): Promise<Record<string, number>> {
  if (property === 'label') return labelFacet(where);
  if (property === 'milestone') return milestoneFacet(where);
  return facetOf(FACET_COLUMNS[property](), where);
}

const summarySchema = issueListSchema.extend({
  groupBy: z.enum(FACET_PROPERTIES).default('state'),
});

export async function getIssueSummary(
  principal: Principal,
  input: unknown = {},
): Promise<IssueSummary> {
  assertCan(principal, 'issue:read');
  const filter = summarySchema.parse(input);
  const matching = and(...buildIssueFilters(principal, filter));

  const [matchedStates, groupTotals] = await Promise.all([
    db
      .select({ stateId: schema.issue.stateId, total: count() })
      .from(schema.issue)
      .where(matching)
      .groupBy(schema.issue.stateId),
    filter.groupBy === 'state' ? null : facetFor(filter.groupBy, matching),
  ]);

  const byState: Record<string, number> = {};
  let total = 0;
  for (const row of matchedStates) {
    byState[row.stateId] = Number(row.total);
    total += Number(row.total);
  }

  return { total, byState, groupTotals: groupTotals ?? byState };
}

export async function getIssueFacets(
  principal: Principal,
  input: unknown = {},
): Promise<IssueFacets> {
  assertCan(principal, 'issue:read');
  const filter = issueListSchema.parse(input);
  const scope = and(...buildScopeFilters(principal, filter));

  const [scopeTotal, facets] = await Promise.all([
    db.select({ total: count() }).from(schema.issue).where(scope),
    allFacets(scope),
  ]);

  return { scopeTotal: Number(scopeTotal[0]?.total ?? 0), facets };
}

export async function getIssue(principal: Principal, idOrIdentifier: string): Promise<IssueRow> {
  assertCan(principal, 'issue:read');
  const parsed = parseIssueIdentifier(idOrIdentifier);
  const match =
    parsed === null
      ? eq(schema.issue.id, idOrIdentifier)
      : eq(schema.issue.identifier, issueIdentifier(parsed.prefix, parsed.number));
  const [row] = await db
    .select()
    .from(schema.issue)
    .where(and(eq(schema.issue.organizationId, principal.organizationId), match))
    .limit(1);
  const issue = requireRow(row, 'That issue does not exist.');
  if (!isInTeam(principal, teamScope(issue))) throw notFound('That issue does not exist.');
  return issue;
}

export async function listIssueLabels(
  principal: Principal,
  issueId: string,
): Promise<{ labelId: string }[]> {
  assertCan(principal, 'issue:read');
  await loadIssue(db, principal, issueId);
  return await db
    .select({ labelId: schema.issueLabel.labelId })
    .from(schema.issueLabel)
    .where(eq(schema.issueLabel.issueId, issueId));
}

export async function setRelation(
  principal: Principal,
  issueId: string,
  input: unknown,
): Promise<{ relations: IssueRelationRow[]; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const parsed = issueRelationSchema.parse(input);
  if (parsed.relatedIssueId === issueId) {
    throw validationFailed('An issue cannot relate to itself.');
  }

  return await db.transaction(async (tx) => {
    const source = await loadIssue(tx, principal, issueId);
    const target = await loadIssue(tx, principal, parsed.relatedIssueId);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const inverse = INVERSE_RELATION[parsed.type];

    const relations = await tx
      .insert(schema.issueRelation)
      .values([
        {
          id: newId(),
          organizationId: principal.organizationId,
          issueId: source.id,
          relatedIssueId: target.id,
          type: parsed.type,
          syncId,
        },
        {
          id: newId(),
          organizationId: principal.organizationId,
          issueId: target.id,
          relatedIssueId: source.id,
          type: inverse,
          syncId,
        },
      ])
      .onConflictDoNothing()
      .returning();

    await appendActivities(tx, [
      {
        organizationId: principal.organizationId,
        issueId: source.id,
        actor,
        field: 'relation',
        from: null,
        to: `${parsed.type} ${target.identifier}`,
        syncId,
      },
    ]);

    return {
      relations,
      actions: relations.map((row) =>
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.issue(row.issueId), scopes.issue(row.relatedIssueId)],
          action: 'insert',
          model: 'issue_relation',
          modelId: row.id,
          data: row,
          actor,
        }),
      ),
    };
  });
}

export async function removeRelation(
  principal: Principal,
  issueId: string,
  input: unknown,
): Promise<SyncAction[]> {
  assertCan(principal, 'issue:update');
  const parsed = issueRelationSchema.parse(input);

  return await db.transaction(async (tx) => {
    await loadIssue(tx, principal, issueId);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const inverse = INVERSE_RELATION[parsed.type];

    const removed = await tx
      .delete(schema.issueRelation)
      .where(
        and(
          eq(schema.issueRelation.organizationId, principal.organizationId),
          or(
            and(
              eq(schema.issueRelation.issueId, issueId),
              eq(schema.issueRelation.relatedIssueId, parsed.relatedIssueId),
              eq(schema.issueRelation.type, parsed.type),
            ),
            and(
              eq(schema.issueRelation.issueId, parsed.relatedIssueId),
              eq(schema.issueRelation.relatedIssueId, issueId),
              eq(schema.issueRelation.type, inverse),
            ),
          ),
        ),
      )
      .returning();
    if (removed.length === 0) throw notFound('That relation does not exist.');

    return removed.map((row) =>
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: [scopes.issue(row.issueId), scopes.issue(row.relatedIssueId)],
        action: 'delete',
        model: 'issue_relation',
        modelId: row.id,
        data: { id: row.id, issueId: row.issueId, relatedIssueId: row.relatedIssueId },
        actor,
      }),
    );
  });
}

export async function listRelations(
  principal: Principal,
  issueId: string,
): Promise<IssueRelationRow[]> {
  assertCan(principal, 'issue:read');
  return await db
    .select()
    .from(schema.issueRelation)
    .where(
      and(
        eq(schema.issueRelation.organizationId, principal.organizationId),
        eq(schema.issueRelation.issueId, issueId),
      ),
    );
}

export async function subscribe(
  principal: Principal,
  issueId: string,
): Promise<{ subscribed: boolean; actions: SyncAction[] }> {
  assertCan(principal, 'issue:read');

  return await db.transaction(async (tx) => {
    const current = await loadIssue(tx, principal, issueId);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await subscribeUsers(tx, issueId, [principal.userId], syncId);
    return {
      subscribed: true,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.issue(issueId), scopes.user(principal.userId)],
          action: 'insert',
          model: 'issue_subscription',
          modelId: `${issueId}:${principal.userId}`,
          data: { issueId, userId: principal.userId, identifier: current.identifier, syncId },
          actor,
        }),
      ],
    };
  });
}

export async function unsubscribe(
  principal: Principal,
  issueId: string,
): Promise<{ subscribed: boolean; actions: SyncAction[] }> {
  assertCan(principal, 'issue:read');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx
      .delete(schema.issueSubscription)
      .where(
        and(
          eq(schema.issueSubscription.issueId, issueId),
          eq(schema.issueSubscription.userId, principal.userId),
        ),
      );
    return {
      subscribed: false,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.issue(issueId), scopes.user(principal.userId)],
          action: 'delete',
          model: 'issue_subscription',
          modelId: `${issueId}:${principal.userId}`,
          data: { issueId, userId: principal.userId, syncId },
          actor,
        }),
      ],
    };
  });
}

export async function listSubscribers(
  principal: Principal,
  issueId: string,
): Promise<{ userId: string }[]> {
  assertCan(principal, 'issue:read');
  await loadIssue(db, principal, issueId);
  return await db
    .select({ userId: schema.issueSubscription.userId })
    .from(schema.issueSubscription)
    .innerJoin(schema.issue, eq(schema.issue.id, schema.issueSubscription.issueId))
    .where(
      and(
        eq(schema.issueSubscription.issueId, issueId),
        eq(schema.issue.organizationId, principal.organizationId),
      ),
    );
}
