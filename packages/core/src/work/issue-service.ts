import { and, asc, count, db, desc, eq, ilike, inArray, isNull, or, schema, sql } from '@orbit/db';
import { SORT_ORDER_STEP } from '@orbit/shared/constants';
import { notFound, validationFailed } from '@orbit/shared/errors';
import type { Actor, SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, assertInTeam } from '@orbit/shared/policy';
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
import { z } from 'zod';
import { appendActivities, principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow, toDateString } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { buildPredicateFilters, today } from './issue-predicates.ts';
import { initialStateFor } from './workflow-state-service.ts';

export type IssueRow = typeof schema.issue.$inferSelect;
export type IssueRelationRow = typeof schema.issueRelation.$inferSelect;
export type IssueValues = Partial<typeof schema.issue.$inferInsert>;

export const REBALANCE_THRESHOLD = 0.0001;

const INVERSE_RELATION = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  related: 'related',
  duplicate_of: 'duplicate_of',
} as const;

export function issueScopes(
  row: Pick<IssueRow, 'organizationId' | 'teamId' | 'id' | 'projectId'>,
): string[] {
  const list = [
    scopes.organization(row.organizationId),
    scopes.team(row.teamId),
    scopes.issue(row.id),
  ];
  if (row.projectId !== null) list.push(scopes.project(row.projectId));
  return list;
}

function issueAction(
  row: IssueRow,
  syncId: number,
  actor: Actor,
  action: 'insert' | 'update' | 'delete' | 'archive' | 'unarchive',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: issueScopes(row),
    action,
    model: 'issue',
    modelId: row.id,
    data: row,
    actor,
  });
}

async function allocateIssueNumber(executor: Executor, teamId: string): Promise<number> {
  const [row] = await executor
    .update(schema.team)
    .set({ issueCounter: sql`${schema.team.issueCounter} + 1` })
    .where(eq(schema.team.id, teamId))
    .returning({ issueCounter: schema.team.issueCounter, key: schema.team.key });
  if (row === undefined) throw notFound('That team does not exist.');
  return row.issueCounter;
}

async function teamKey(executor: Executor, teamId: string): Promise<string> {
  const [row] = await executor
    .select({ key: schema.team.key })
    .from(schema.team)
    .where(eq(schema.team.id, teamId))
    .limit(1);
  return requireRow(row, 'That team does not exist.').key;
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
  organizationId: string,
  issueId: string,
): Promise<IssueRow> {
  const [row] = await executor
    .select()
    .from(schema.issue)
    .where(and(eq(schema.issue.id, issueId), eq(schema.issue.organizationId, organizationId)))
    .limit(1);
  return requireRow(row, 'That issue does not exist.');
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
): Promise<void> {
  const unique = [...new Set(userIds.filter((id): id is string => id !== null))];
  await subscribeToIssues(
    executor,
    unique.map((userId) => ({ issueId, userId })),
  );
}

export interface CreatedIssue {
  readonly issue: IssueRow;
  readonly actions: SyncAction[];
}

export async function createIssue(principal: Principal, input: unknown): Promise<CreatedIssue> {
  assertCan(principal, 'issue:create');
  const parsed = issueCreateSchema.parse(input);
  assertInTeam(principal, parsed.teamId);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const state =
      parsed.stateId === undefined
        ? await initialStateFor(tx, parsed.teamId)
        : await stateOf(tx, parsed.stateId);
    if (state.teamId !== parsed.teamId) {
      throw validationFailed('That status belongs to another team.');
    }

    const number = await allocateIssueNumber(tx, parsed.teamId);
    const key = await teamKey(tx, parsed.teamId);
    const now = new Date();

    const [created] = await tx
      .insert(schema.issue)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        teamId: parsed.teamId,
        number,
        identifier: issueIdentifier(key, number),
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
        sortOrder: await topOfColumn(tx, parsed.teamId, state.id),
        ...stateTimestamps(state.category, now),
        syncId,
      })
      .returning();
    const issue = requireRow(created, 'The issue could not be created.');

    await replaceLabels(tx, issue.id, parsed.labelIds);
    await subscribeUsers(tx, issue.id, [principal.userId, parsed.assigneeId]);
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

    return { issue, actions: [issueAction(issue, syncId, actor, 'insert')] };
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
    assertInTeam(principal, current.teamId);

    const { values, changes } = collectIssueChanges(current, parsed);
    if (values.stateId !== undefined) {
      if (state === null || state.teamId !== current.teamId) {
        throw validationFailed('That status belongs to another team.');
      }
      Object.assign(values, applyStateTimestamps(current, state.category, now));
    }
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

  return pending.map((entry) => {
    const issue = updated.get(entry.current.id);
    if (issue === undefined) return { issue: entry.current, changes: [], actions: [] };
    return {
      issue,
      changes: entry.changes,
      actions: [issueAction(issue, syncId, actor, 'update')],
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

export async function moveIssue(
  principal: Principal,
  issueId: string,
  input: unknown,
): Promise<MovedIssue> {
  assertCan(principal, 'issue:update');
  const parsed = issueMoveSchema.parse(input);

  return await db.transaction(async (tx) => {
    const current = await loadIssue(tx, principal.organizationId, issueId);
    assertInTeam(principal, current.teamId);

    const teamId = parsed.teamId ?? current.teamId;
    assertInTeam(principal, teamId);
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
      const number = await allocateIssueNumber(tx, teamId);
      values.teamId = teamId;
      values.number = number;
      values.identifier = issueIdentifier(await teamKey(tx, teamId), number);
    }
    if (state.id !== current.stateId) {
      values.stateId = state.id;
      Object.assign(values, applyStateTimestamps(current, state.category, now));
    }

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

    return {
      issue,
      rebalanced,
      actions: [
        issueAction(issue, syncId, actor, 'update'),
        ...rebalanced
          .filter((row) => row.id !== issueId)
          .map((row) => issueAction(row, syncId, actor, 'update')),
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
    const current = await loadIssue(tx, principal.organizationId, issueId);
    assertInTeam(principal, current.teamId);

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
      actions: [issueAction(issue, syncId, actor, archivedAt === null ? 'unarchive' : 'archive')],
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
    const current = await loadIssue(tx, principal.organizationId, issueId);
    assertInTeam(principal, current.teamId);

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
const ISSUE_LIST_COLUMNS = { ...ISSUE_COLUMNS, description: sql<string>`''` };

function buildIssueFilters(
  organizationId: string,
  filter: ReturnType<typeof issueListSchema.parse>,
): SQL[] {
  const filters: SQL[] = [eq(schema.issue.organizationId, organizationId)];
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
  filters.push(...buildPredicateFilters(filter.predicates, today()));
  return filters;
}

type OrderKey = ReturnType<typeof issueListSchema.parse>['orderBy'];

const ORDERINGS: Record<
  OrderKey,
  {
    expression: SQL;
    descending: boolean;
    cast: string;
    read: (row: IssueRow) => string | number;
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

export interface IssuePage {
  readonly issues: IssueRow[];
  readonly nextCursor: string | null;
}

export async function listIssues(principal: Principal, input: unknown = {}): Promise<IssuePage> {
  assertCan(principal, 'issue:read');
  const filter = issueListSchema.parse(input);
  const ordering = ORDERINGS[filter.orderBy];
  const filters = buildIssueFilters(principal.organizationId, filter);

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
  const filters = buildIssueFilters(principal.organizationId, filter);
  return await db
    .select({ stateId: schema.issue.stateId, total: count() })
    .from(schema.issue)
    .where(and(...filters))
    .groupBy(schema.issue.stateId);
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
  return requireRow(row, 'That issue does not exist.');
}

export async function listIssueLabels(
  principal: Principal,
  issueId: string,
): Promise<{ labelId: string }[]> {
  assertCan(principal, 'issue:read');
  await loadIssue(db, principal.organizationId, issueId);
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
    const source = await loadIssue(tx, principal.organizationId, issueId);
    const target = await loadIssue(tx, principal.organizationId, parsed.relatedIssueId);
    assertInTeam(principal, source.teamId);

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
          scopes: [
            scopes.organization(principal.organizationId),
            scopes.issue(row.issueId),
            scopes.issue(row.relatedIssueId),
          ],
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
    const source = await loadIssue(tx, principal.organizationId, issueId);
    assertInTeam(principal, source.teamId);

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
        scopes: [
          scopes.organization(principal.organizationId),
          scopes.issue(row.issueId),
          scopes.issue(row.relatedIssueId),
        ],
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
    const current = await loadIssue(tx, principal.organizationId, issueId);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await subscribeUsers(tx, issueId, [principal.userId]);
    return {
      subscribed: true,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.issue(issueId), scopes.user(principal.userId)],
          action: 'insert',
          model: 'notification',
          modelId: `${issueId}:${principal.userId}`,
          data: { issueId, userId: principal.userId, identifier: current.identifier },
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
          model: 'notification',
          modelId: `${issueId}:${principal.userId}`,
          data: { issueId, userId: principal.userId },
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
