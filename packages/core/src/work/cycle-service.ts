import {
  and,
  asc,
  count,
  db,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  schema,
  sql,
} from '@orbit/db';
import { conflict } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { sprintLabel } from '@orbit/shared/utils';
import { cycleCreateSchema, cycleEditSchema } from '@orbit/shared/validators';
import { z } from 'zod';
import { principalActor } from '../activity/activity-service.ts';
import { addUtcDays, type Executor, newId, requireRow, startOfUtcDay } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { issueScopes } from './issue-service.ts';

export type CycleRow = typeof schema.cycle.$inferSelect;

export const DEFAULT_SPRINT_DAYS = 14;

function cycleScopes(row: CycleRow): string[] {
  return [scopes.organization(row.organizationId)];
}

async function lockCycles(executor: Executor, organizationId: string): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${`cycle:${organizationId}`}))`);
}

async function requireCycleForUpdate(
  executor: Executor,
  principal: Principal,
  cycleId: string,
): Promise<CycleRow> {
  const [found] = await executor
    .select()
    .from(schema.cycle)
    .where(
      and(eq(schema.cycle.id, cycleId), eq(schema.cycle.organizationId, principal.organizationId)),
    )
    .limit(1);
  return requireRow(found, 'That cycle does not exist.');
}

async function assertCycleWindow(
  executor: Executor,
  window: {
    organizationId: string;
    startsAt: Date;
    endsAt: Date;
    excludingCycleId: string | null;
  },
): Promise<void> {
  if (window.endsAt.getTime() <= window.startsAt.getTime()) {
    throw conflict('A cycle has to end after it starts.');
  }
  await lockCycles(executor, window.organizationId);
  const [clash] = await executor
    .select({ id: schema.cycle.id, name: schema.cycle.name, number: schema.cycle.number })
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, window.organizationId),
        isNull(schema.cycle.archivedAt),
        isNull(schema.cycle.completedAt),
        lt(schema.cycle.startsAt, window.endsAt),
        gt(schema.cycle.endsAt, window.startsAt),
        window.excludingCycleId === null ? undefined : ne(schema.cycle.id, window.excludingCycleId),
      ),
    )
    .limit(1);
  if (clash !== undefined) {
    throw conflict(`Those dates overlap ${sprintLabel(clash)}.`, {
      details: { cycleId: clash.id },
    });
  }
}

async function nextCycleNumber(executor: Executor, organizationId: string): Promise<number> {
  const [row] = await executor
    .select({ number: schema.cycle.number })
    .from(schema.cycle)
    .where(eq(schema.cycle.organizationId, organizationId))
    .orderBy(desc(schema.cycle.number))
    .limit(1);
  return (row?.number ?? 0) + 1;
}

async function afterTheLastSprint(
  executor: Executor,
  organizationId: string,
  now: Date,
): Promise<Date> {
  const [latest] = await executor
    .select({ endsAt: schema.cycle.endsAt })
    .from(schema.cycle)
    .where(and(eq(schema.cycle.organizationId, organizationId), isNull(schema.cycle.archivedAt)))
    .orderBy(desc(schema.cycle.endsAt))
    .limit(1);
  const today = startOfUtcDay(now);
  if (latest === undefined) return today;
  return latest.endsAt.getTime() > today.getTime() ? latest.endsAt : today;
}

export async function createCycle(
  principal: Principal,
  input: unknown,
  now: Date = new Date(),
): Promise<{ cycle: CycleRow; actions: SyncAction[] }> {
  assertCan(principal, 'cycle:manage');
  const parsed = cycleCreateSchema.parse(input);
  return await db.transaction(async (tx) => {
    const organizationId = principal.organizationId;
    await lockCycles(tx, organizationId);
    const startsAt = parsed.startsAt ?? (await afterTheLastSprint(tx, organizationId, now));
    const endsAt = parsed.endsAt ?? addUtcDays(startsAt, DEFAULT_SPRINT_DAYS);
    await assertCycleWindow(tx, {
      organizationId,
      startsAt,
      endsAt,
      excludingCycleId: null,
    });
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const number = await nextCycleNumber(tx, organizationId);
    const [created] = await tx
      .insert(schema.cycle)
      .values({
        id: newId(),
        organizationId,
        teamId: null,
        number,
        name: parsed.name ?? '',
        startsAt,
        endsAt,
        syncId,
      })
      .returning();
    const cycle = requireRow(created, 'The cycle could not be created.');
    return {
      cycle,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: cycleScopes(cycle),
          action: 'insert',
          model: 'cycle',
          modelId: cycle.id,
          data: cycle,
          actor,
        }),
      ],
    };
  });
}

const DAY_MS = 86_400_000;

export async function updateCycle(
  principal: Principal,
  cycleId: string,
  input: unknown,
): Promise<{ cycle: CycleRow; actions: SyncAction[] }> {
  assertCan(principal, 'cycle:manage');
  const parsed = cycleEditSchema.parse(input);

  return await db.transaction(async (tx) => {
    const found = await requireCycleForUpdate(tx, principal, cycleId);
    await lockCycles(tx, found.organizationId);
    const current = await requireCycleForUpdate(tx, principal, cycleId);

    const values: Partial<typeof schema.cycle.$inferInsert> = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.startsAt !== undefined) values.startsAt = parsed.startsAt;
    if (parsed.endsAt !== undefined) values.endsAt = parsed.endsAt;

    const millis =
      parsed.shiftFollowing === true && parsed.endsAt !== undefined
        ? parsed.endsAt.getTime() - current.endsAt.getTime()
        : 0;
    const moved = await shiftFollowingWithin(tx, principal, current, {
      after: current.endsAt,
      millis,
    });

    if (parsed.startsAt !== undefined || parsed.endsAt !== undefined) {
      await assertCycleWindow(tx, {
        organizationId: current.organizationId,
        startsAt: parsed.startsAt ?? current.startsAt,
        endsAt: parsed.endsAt ?? current.endsAt,
        excludingCycleId: current.id,
      });
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.cycle)
      .set({ ...values, syncId })
      .where(
        and(
          eq(schema.cycle.id, cycleId),
          eq(schema.cycle.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const cycle = requireRow(updated, 'That cycle does not exist.');
    return {
      cycle,
      actions: [
        ...moved.actions,
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: cycleScopes(cycle),
          action: 'update',
          model: 'cycle',
          modelId: cycle.id,
          data: cycle,
          actor,
        }),
      ],
    };
  });
}

async function shiftFollowingWithin(
  tx: Executor,
  principal: Principal,
  anchor: CycleRow,
  options: { readonly after: Date; readonly millis: number },
): Promise<{ shifted: CycleRow[]; actions: SyncAction[] }> {
  const { after, millis } = options;
  if (millis === 0) return { shifted: [], actions: [] };

  await lockCycles(tx, anchor.organizationId);

  const following = await tx
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, anchor.organizationId),
        isNull(schema.cycle.archivedAt),
        gte(schema.cycle.startsAt, after),
        ne(schema.cycle.id, anchor.id),
      ),
    )
    .orderBy(asc(schema.cycle.startsAt));

  const movable: CycleRow[] = [];
  for (const row of following) {
    if (row.completedAt !== null) break;
    movable.push(row);
  }
  if (movable.length === 0) return { shifted: [], actions: [] };

  const syncId = await nextSyncId(tx);
  const actor = await principalActor(tx, principal);
  const shifted: CycleRow[] = [];

  const moving = new Set(movable.map((row) => row.id));
  for (const row of movable) {
    const startsAt = new Date(row.startsAt.getTime() + millis);
    const endsAt = new Date(row.endsAt.getTime() + millis);
    const [landedOn] = await tx
      .select({ id: schema.cycle.id, name: schema.cycle.name, number: schema.cycle.number })
      .from(schema.cycle)
      .where(
        and(
          eq(schema.cycle.organizationId, anchor.organizationId),
          isNull(schema.cycle.archivedAt),
          isNotNull(schema.cycle.completedAt),
          lt(schema.cycle.startsAt, endsAt),
          gt(schema.cycle.endsAt, startsAt),
        ),
      )
      .limit(1);
    if (landedOn !== undefined && !moving.has(landedOn.id)) {
      throw conflict(`Moving those sprints would land on ${sprintLabel(landedOn)}.`, {
        details: { cycleId: landedOn.id },
      });
    }

    const [moved] = await tx
      .update(schema.cycle)
      .set({ startsAt, endsAt, syncId })
      .where(eq(schema.cycle.id, row.id))
      .returning();
    shifted.push(requireRow(moved, 'That cycle does not exist.'));
  }

  return {
    shifted,
    actions: shifted.map((row) =>
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: cycleScopes(row),
        action: 'update',
        model: 'cycle',
        modelId: row.id,
        data: row,
        actor,
      }),
    ),
  };
}

export async function shiftFollowingCycles(
  principal: Principal,
  cycleId: string,
  options: { readonly after: Date; readonly days: number },
): Promise<{ shifted: CycleRow[]; actions: SyncAction[] }> {
  assertCan(principal, 'cycle:manage');

  return await db.transaction(async (tx) => {
    const found = await requireCycleForUpdate(tx, principal, cycleId);
    await lockCycles(tx, found.organizationId);
    const anchor = await requireCycleForUpdate(tx, principal, cycleId);
    return await shiftFollowingWithin(tx, principal, anchor, {
      after: options.after,
      millis: options.days * DAY_MS,
    });
  });
}

async function assertNothingRunning(
  executor: Executor,
  organizationId: string,
  exceptCycleId: string,
  now: Date,
): Promise<void> {
  const [running] = await executor
    .select({ name: schema.cycle.name, number: schema.cycle.number })
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, organizationId),
        isNull(schema.cycle.archivedAt),
        isNull(schema.cycle.completedAt),
        ne(schema.cycle.id, exceptCycleId),
        lte(schema.cycle.startsAt, now),
        gt(schema.cycle.endsAt, now),
      ),
    )
    .limit(1);
  if (running !== undefined) {
    throw conflict(
      `${sprintLabel(running)} is still running. Complete it before starting another.`,
    );
  }
}

function assertStartable(cycle: CycleRow, now: Date): void {
  if (cycle.archivedAt !== null) throw conflict('That sprint has been archived.');
  if (cycle.completedAt !== null) throw conflict('That sprint is already complete.');
  if (cycle.startsAt.getTime() <= now.getTime()) {
    throw conflict('That sprint is already under way.');
  }
}

export async function startCycle(
  principal: Principal,
  cycleId: string,
  now: Date = new Date(),
): Promise<{ cycle: CycleRow; actions: SyncAction[] }> {
  assertCan(principal, 'cycle:manage');

  return await db.transaction(async (tx) => {
    const current = await requireCycleForUpdate(tx, principal, cycleId);
    await lockCycles(tx, current.organizationId);
    const locked = await requireCycleForUpdate(tx, principal, cycleId);

    assertStartable(locked, now);
    await assertNothingRunning(tx, locked.organizationId, locked.id, now);
    await assertCycleWindow(tx, {
      organizationId: locked.organizationId,
      startsAt: now,
      endsAt: locked.endsAt,
      excludingCycleId: locked.id,
    });

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.cycle)
      .set({ startsAt: now, syncId })
      .where(eq(schema.cycle.id, locked.id))
      .returning();
    const cycle = requireRow(updated, 'That cycle does not exist.');
    return {
      cycle,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: cycleScopes(cycle),
          action: 'update',
          model: 'cycle',
          modelId: cycle.id,
          data: cycle,
          actor,
        }),
      ],
    };
  });
}

export async function deleteCycle(principal: Principal, cycleId: string): Promise<SyncAction[]> {
  assertCan(principal, 'cycle:manage');

  return await db.transaction(async (tx) => {
    const cycle = await requireCycleForUpdate(tx, principal, cycleId);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);

    const detached = await tx
      .update(schema.issue)
      .set({ cycleId: null, updatedAt: new Date(), syncId })
      .where(eq(schema.issue.cycleId, cycleId))
      .returning();

    await tx.delete(schema.cycle).where(eq(schema.cycle.id, cycleId));
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: cycleScopes(cycle),
        action: 'delete',
        model: 'cycle',
        modelId: cycleId,
        data: { id: cycleId, teamId: cycle.teamId },
        actor,
      }),
      ...detached.map((row) =>
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: issueScopes(row),
          action: 'update',
          model: 'issue',
          modelId: row.id,
          data: row,
          actor,
        }),
      ),
    ];
  });
}

export async function listCycles(principal: Principal): Promise<CycleRow[]> {
  assertCan(principal, 'issue:read');
  return await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        isNull(schema.cycle.archivedAt),
      ),
    )
    .orderBy(asc(schema.cycle.number));
}

export const SPRINT_PAGE_SIZE = 25;

function whole(value: number | undefined, fallback: number, most: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), most);
}

export async function pageOfCycles(
  principal: Principal,
  options: { page?: number; pageSize?: number } = {},
): Promise<{ cycles: CycleRow[]; total: number; page: number; pageCount: number }> {
  assertCan(principal, 'issue:read');
  const pageSize = whole(options.pageSize, SPRINT_PAGE_SIZE, 100);
  const belongs = and(
    eq(schema.cycle.organizationId, principal.organizationId),
    isNull(schema.cycle.archivedAt),
  );

  const [counted] = await db.select({ total: count() }).from(schema.cycle).where(belongs);
  const total = counted?.total ?? 0;
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(whole(options.page, 1, pageCount), pageCount);

  const cycles = await db
    .select()
    .from(schema.cycle)
    .where(belongs)
    .orderBy(desc(schema.cycle.startsAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { cycles, total, page, pageCount };
}

export async function getCycle(principal: Principal, cycleId: string): Promise<CycleRow> {
  assertCan(principal, 'issue:read');
  const [row] = await db
    .select()
    .from(schema.cycle)
    .where(
      and(eq(schema.cycle.id, cycleId), eq(schema.cycle.organizationId, principal.organizationId)),
    )
    .limit(1);
  return requireRow(row, 'That cycle does not exist.');
}

export async function activeCycle(
  principal: Principal,
  now: Date = new Date(),
): Promise<CycleRow | undefined> {
  assertCan(principal, 'issue:read');
  const [row] = await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        isNull(schema.cycle.archivedAt),
        isNull(schema.cycle.completedAt),
        lte(schema.cycle.startsAt, now),
        gt(schema.cycle.endsAt, now),
      ),
    )
    .orderBy(asc(schema.cycle.startsAt))
    .limit(1);
  return row;
}

export async function upcomingCycles(
  principal: Principal,
  options: { now?: Date; limit?: number } = {},
): Promise<CycleRow[]> {
  assertCan(principal, 'issue:read');
  return await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        isNull(schema.cycle.archivedAt),
        isNull(schema.cycle.completedAt),
        gt(schema.cycle.startsAt, options.now ?? new Date()),
      ),
    )
    .orderBy(asc(schema.cycle.startsAt))
    .limit(options.limit ?? 10);
}

export interface BurnUpPoint {
  readonly date: string;
  readonly scope: number;
  readonly scopePoints: number;
  readonly completed: number;
  readonly completedPoints: number;
}

export interface CyclePoints {
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
}

export interface CycleScopeChanges {
  readonly added: number;
  readonly addedPoints: number;
  readonly removed: number;
  readonly removedPoints: number;
}

export interface UncommittedTally {
  readonly issues: number;
  readonly points: number;
}

export interface CycleProgress {
  readonly cycleId: string;
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
  readonly canceled: number;
  readonly uncommitted: UncommittedTally;
  readonly estimated: number;
  readonly points: CyclePoints;
  readonly changes: CycleScopeChanges;
  readonly burnUp: BurnUpPoint[];
}

const CYCLE_CATEGORY = sql<string>`${schema.workflowState.category}`;

const ACTIVITY_FROM_CYCLE = sql<
  string | null
>`coalesce(${schema.issueActivity.fromValue}->>'id', ${schema.issueActivity.fromValue} #>> '{}')`;

const ACTIVITY_TO_CYCLE = sql<
  string | null
>`coalesce(${schema.issueActivity.toValue}->>'id', ${schema.issueActivity.toValue} #>> '{}')`;

interface CycleIssueFacts {
  readonly estimate: number;
  readonly estimated: boolean;
  readonly category: string;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly canceledAt: Date | null;
  readonly member: boolean;
}

interface MembershipMove {
  readonly at: Date;
  readonly entered: boolean;
}

interface MembershipEntry {
  readonly issue: CycleIssueFacts;
  readonly initial: boolean;
  readonly moves: readonly MembershipMove[];
}

async function cycleMembershipMoves(
  cycle: CycleRow,
  windowEnd: Date,
): Promise<Map<string, MembershipMove[]>> {
  const moves = new Map<string, MembershipMove[]>();
  if (windowEnd.getTime() <= cycle.startsAt.getTime()) return moves;
  const rows = await db
    .select({
      issueId: schema.issueActivity.issueId,
      at: schema.issueActivity.createdAt,
      entered: sql<boolean>`coalesce(${ACTIVITY_TO_CYCLE} = ${cycle.id}, false)`,
    })
    .from(schema.issueActivity)
    .where(
      and(
        eq(schema.issueActivity.organizationId, cycle.organizationId),
        eq(schema.issueActivity.field, 'cycleId'),
        gte(schema.issueActivity.createdAt, cycle.startsAt),
        sql`${cycle.id} in (${ACTIVITY_FROM_CYCLE}, ${ACTIVITY_TO_CYCLE})`,
      ),
    )
    .orderBy(asc(schema.issueActivity.createdAt), asc(schema.issueActivity.id));
  for (const row of rows) {
    const list = moves.get(row.issueId) ?? [];
    list.push({ at: row.at, entered: row.entered });
    moves.set(row.issueId, list);
  }
  return moves;
}

async function cycleIssueFacts(
  cycle: CycleRow,
  alsoTouchedBy: readonly string[],
): Promise<Map<string, CycleIssueFacts>> {
  const inCycle = eq(schema.issue.cycleId, cycle.id);
  const rows = await db
    .select({
      id: schema.issue.id,
      cycleId: schema.issue.cycleId,
      estimate: schema.issue.estimate,
      category: CYCLE_CATEGORY,
      createdAt: schema.issue.createdAt,
      completedAt: schema.issue.completedAt,
      canceledAt: schema.issue.canceledAt,
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(
      and(
        eq(schema.issue.organizationId, cycle.organizationId),
        isNull(schema.issue.archivedAt),
        alsoTouchedBy.length === 0
          ? inCycle
          : or(inCycle, inArray(schema.issue.id, [...alsoTouchedBy])),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        estimate: row.estimate ?? 0,
        estimated: row.estimate !== null,
        category: row.category,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        canceledAt: row.canceledAt,
        member: row.cycleId === cycle.id,
      },
    ]),
  );
}

function membershipEntries(
  issues: ReadonlyMap<string, CycleIssueFacts>,
  moves: ReadonlyMap<string, MembershipMove[]>,
): MembershipEntry[] {
  const entries: MembershipEntry[] = [];
  for (const [issueId, issue] of issues) {
    const own = moves.get(issueId) ?? [];
    const first = own[0];
    entries.push({
      issue,
      initial: first === undefined ? issue.member : !first.entered,
      moves: own,
    });
  }
  return entries;
}

function inCycleAt(entry: MembershipEntry, cutoff: number): boolean {
  if (entry.issue.createdAt.getTime() >= cutoff) return false;
  let inside = entry.initial;
  for (const move of entry.moves) {
    if (move.at.getTime() >= cutoff) break;
    inside = move.entered;
  }
  return inside;
}

function droppedBy(issue: CycleIssueFacts, cutoff: number): boolean {
  if (isCommitted(issue.category)) return false;
  if (issue.category !== 'canceled') return true;
  return issue.canceledAt === null || issue.canceledAt.getTime() < cutoff;
}

function inScopeAt(entry: MembershipEntry, cutoff: number): boolean {
  return inCycleAt(entry, cutoff) && !droppedBy(entry.issue, cutoff);
}

function joinedAt(entry: MembershipEntry, cycleStart: Date): number {
  if (entry.initial) return Math.max(cycleStart.getTime(), entry.issue.createdAt.getTime());
  const first = entry.moves[0];
  return first === undefined ? Number.POSITIVE_INFINITY : first.at.getTime();
}

function pointOn(entries: readonly MembershipEntry[], day: Date): BurnUpPoint {
  const cutoff = addUtcDays(day, 1).getTime();
  let scope = 0;
  let scopePoints = 0;
  let completed = 0;
  let completedPoints = 0;
  for (const entry of entries) {
    if (!inScopeAt(entry, cutoff)) continue;
    scope += 1;
    scopePoints += entry.issue.estimate;
    const done = entry.issue.completedAt;
    if (done === null || done.getTime() >= cutoff) continue;
    completed += 1;
    completedPoints += entry.issue.estimate;
  }
  return { date: day.toISOString().slice(0, 10), scope, scopePoints, completed, completedPoints };
}

function scopeChanges(
  entries: readonly MembershipEntry[],
  cycleStart: Date,
  windowEnd: Date,
): CycleScopeChanges {
  const changes = { added: 0, addedPoints: 0, removed: 0, removedPoints: 0 };
  const end = windowEnd.getTime();
  const firstDayEnds = addUtcDays(startOfUtcDay(cycleStart), 1).getTime();
  for (const entry of entries) {
    const joined = joinedAt(entry, cycleStart);
    if (joined >= end) continue;
    if (joined >= firstDayEnds) {
      changes.added += 1;
      changes.addedPoints += entry.issue.estimate;
    }
    if (inCycleAt(entry, end)) continue;
    changes.removed += 1;
    changes.removedPoints += entry.issue.estimate;
  }
  return changes;
}

function sumEstimates(rows: readonly CycleIssueFacts[]): number {
  return rows.reduce((total, row) => total + row.estimate, 0);
}

const UNCOMMITTED_CATEGORIES: readonly string[] = ['triage', 'backlog'];

export function isCommitted(category: string): boolean {
  return category !== 'canceled' && !UNCOMMITTED_CATEGORIES.includes(category);
}

function currentTotals(
  issues: ReadonlyMap<string, CycleIssueFacts>,
): Pick<
  CycleProgress,
  'scope' | 'started' | 'completed' | 'canceled' | 'uncommitted' | 'estimated' | 'points'
> {
  const members = [...issues.values()].filter((issue) => issue.member);
  const inScope = members.filter((issue) => isCommitted(issue.category));
  const started = inScope.filter(
    (issue) => issue.category === 'started' || issue.category === 'review',
  );
  const completed = inScope.filter((issue) => issue.category === 'completed');
  const uncommitted = members.filter((issue) => UNCOMMITTED_CATEGORIES.includes(issue.category));
  return {
    scope: inScope.length,
    started: started.length,
    completed: completed.length,
    canceled: members.filter((issue) => issue.category === 'canceled').length,
    uncommitted: { issues: uncommitted.length, points: sumEstimates(uncommitted) },
    estimated: inScope.filter((issue) => issue.estimated).length,
    points: {
      scope: sumEstimates(inScope),
      started: sumEstimates(started),
      completed: sumEstimates(completed),
    },
  };
}

export async function cycleProgress(
  principal: Principal,
  cycleId: string,
  now: Date = new Date(),
): Promise<CycleProgress> {
  const cycle = await getCycle(principal, cycleId);
  const start = startOfUtcDay(cycle.startsAt);
  const finish = startOfUtcDay(now < cycle.endsAt ? now : cycle.endsAt);
  const windowEnd = finish < start ? start : addUtcDays(finish, 1);

  const moves = await cycleMembershipMoves(cycle, windowEnd);
  const issues = await cycleIssueFacts(cycle, [...moves.keys()]);
  const entries = membershipEntries(issues, moves);

  const burnUp: BurnUpPoint[] = [];
  for (let day = start; day <= finish; day = addUtcDays(day, 1)) {
    burnUp.push(pointOn(entries, day));
  }

  return {
    cycleId,
    ...currentTotals(issues),
    changes: scopeChanges(entries, cycle.startsAt, windowEnd),
    burnUp,
  };
}

export interface CompletedCycle {
  readonly cycle: CycleRow;
  readonly nextCycle: CycleRow;
  readonly rolledOverIssueIds: string[];
  readonly releasedIssueIds: string[];
  readonly actions: SyncAction[];
}

export interface SprintOutcome {
  readonly scope: number;
  readonly completed: number;
  readonly canceled: number;
  readonly rolledOver: number;
  readonly points: { readonly scope: number; readonly completed: number };
  readonly closedAt: string;
}

function outcomeOf(
  rows: readonly { category: string; estimate: number | null }[],
  rolledOver: number,
  now: Date,
): SprintOutcome {
  const done = rows.filter((row) => row.category === 'completed');
  const points = (list: readonly { estimate: number | null }[]) =>
    list.reduce((total, row) => total + (row.estimate ?? 0), 0);
  return {
    scope: rows.length,
    completed: done.length,
    canceled: rows.filter((row) => row.category === 'canceled').length,
    rolledOver,
    points: { scope: points(rows), completed: points(done) },
    closedAt: now.toISOString(),
  };
}

function readStoredOutcome(value: unknown): SprintOutcome | null {
  const parsed = storedOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const storedOutcomeSchema = z.object({
  scope: z.number(),
  completed: z.number(),
  canceled: z.number().default(0),
  rolledOver: z.number().default(0),
  points: z
    .object({ scope: z.number(), completed: z.number() })
    .default({ scope: 0, completed: 0 }),
  closedAt: z.string(),
});

export interface RecordedOutcome extends SprintOutcome {
  readonly reconstructed: boolean;
}

export async function sprintOutcome(
  principal: Principal,
  cycleId: string,
): Promise<RecordedOutcome | null> {
  const cycle = await getCycle(principal, cycleId);
  const [outcome] = await outcomesFor([cycle]);
  return outcome ?? null;
}

export async function sprintOutcomes(
  principal: Principal,
  cycles: readonly CycleRow[],
): Promise<(RecordedOutcome | null)[]> {
  assertCan(principal, 'project:read');
  return await outcomesFor(cycles);
}

async function outcomesFor(cycles: readonly CycleRow[]): Promise<(RecordedOutcome | null)[]> {
  const needsCounting = cycles.filter(
    (cycle) => cycle.completedAt !== null && readStoredOutcome(cycle.progressSnapshot) === null,
  );

  const counted = new Map<string, { category: string; estimate: number | null }[]>();
  if (needsCounting.length > 0) {
    const rows = await db
      .select({
        cycleId: schema.issue.cycleId,
        category: CYCLE_CATEGORY,
        estimate: schema.issue.estimate,
      })
      .from(schema.issue)
      .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
      .where(
        and(
          inArray(
            schema.issue.cycleId,
            needsCounting.map((cycle) => cycle.id),
          ),
          isNull(schema.issue.archivedAt),
        ),
      );
    for (const row of rows) {
      if (row.cycleId === null) continue;
      const list = counted.get(row.cycleId) ?? [];
      list.push({ category: row.category, estimate: row.estimate });
      counted.set(row.cycleId, list);
    }
  }

  return cycles.map((cycle) => {
    if (cycle.completedAt === null) return null;
    const stored = readStoredOutcome(cycle.progressSnapshot);
    if (stored !== null) return { ...stored, reconstructed: false };
    return { ...outcomeOf(counted.get(cycle.id) ?? [], 0, cycle.completedAt), reconstructed: true };
  });
}

export async function pastCycles(principal: Principal, limit = 12): Promise<CycleRow[]> {
  assertCan(principal, 'project:read');
  return await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        isNull(schema.cycle.archivedAt),
        isNotNull(schema.cycle.completedAt),
      ),
    )
    .orderBy(desc(schema.cycle.number))
    .limit(Math.min(Math.max(limit, 1), 50));
}

export async function getCycleByNumber(
  principal: Principal,
  number: number,
): Promise<CycleRow | null> {
  assertCan(principal, 'project:read');
  const [row] = await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        eq(schema.cycle.number, number),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function completeCycle(
  principal: Principal,
  cycleId: string,
  now: Date = new Date(),
): Promise<CompletedCycle> {
  assertCan(principal, 'cycle:manage');

  return await db.transaction(async (tx) => {
    const found = await requireCycleForUpdate(tx, principal, cycleId);
    await lockCycles(tx, found.organizationId);
    const cycle = await requireCycleForUpdate(tx, principal, cycleId);
    if (cycle.completedAt !== null) {
      throw conflict('That cycle is already complete.');
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);

    const [existingNext] = await tx
      .select()
      .from(schema.cycle)
      .where(
        and(
          eq(schema.cycle.organizationId, cycle.organizationId),
          isNull(schema.cycle.archivedAt),
          isNull(schema.cycle.completedAt),
          ne(schema.cycle.id, cycle.id),
          gte(schema.cycle.startsAt, cycle.endsAt),
        ),
      )
      .orderBy(asc(schema.cycle.startsAt))
      .limit(1);

    let nextCycle = existingNext;
    if (nextCycle === undefined) {
      const [latest] = await tx
        .select({ endsAt: schema.cycle.endsAt, number: schema.cycle.number })
        .from(schema.cycle)
        .where(
          and(
            eq(schema.cycle.organizationId, cycle.organizationId),
            isNull(schema.cycle.archivedAt),
          ),
        )
        .orderBy(desc(schema.cycle.endsAt))
        .limit(1);
      const [highest] = await tx
        .select({ number: schema.cycle.number })
        .from(schema.cycle)
        .where(eq(schema.cycle.organizationId, cycle.organizationId))
        .orderBy(desc(schema.cycle.number))
        .limit(1);

      const startsAt =
        latest !== undefined && latest.endsAt.getTime() > cycle.endsAt.getTime()
          ? latest.endsAt
          : cycle.endsAt;
      const number = (highest?.number ?? cycle.number) + 1;
      const [created] = await tx
        .insert(schema.cycle)
        .values({
          id: newId(),
          organizationId: cycle.organizationId,
          teamId: null,
          number,
          name: '',
          startsAt,
          endsAt: addUtcDays(startsAt, 14),
          syncId,
        })
        .returning();
      nextCycle = requireRow(created, 'The next cycle could not be created.');
    }

    const openStateIds = tx
      .select({ id: schema.workflowState.id })
      .from(schema.workflowState)
      .where(
        and(
          eq(schema.workflowState.organizationId, cycle.organizationId),
          sql`${schema.workflowState.category} not in ('completed', 'canceled', 'triage', 'backlog')`,
        ),
      );

    const atClose = await tx
      .select({
        stateId: schema.issue.stateId,
        estimate: schema.issue.estimate,
        category: schema.workflowState.category,
      })
      .from(schema.issue)
      .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
      .where(and(eq(schema.issue.cycleId, cycleId), isNull(schema.issue.archivedAt)));

    const uncommittedStateIds = tx
      .select({ id: schema.workflowState.id })
      .from(schema.workflowState)
      .where(
        and(
          eq(schema.workflowState.organizationId, cycle.organizationId),
          sql`${schema.workflowState.category} in ('triage', 'backlog')`,
        ),
      );

    const released = await tx
      .update(schema.issue)
      .set({ cycleId: null, updatedAt: now, syncId })
      .where(
        and(
          eq(schema.issue.cycleId, cycleId),
          isNull(schema.issue.archivedAt),
          sql`${schema.issue.stateId} in ${uncommittedStateIds}`,
        ),
      )
      .returning();

    const rolled = await tx
      .update(schema.issue)
      .set({ cycleId: nextCycle.id, updatedAt: now, syncId })
      .where(
        and(
          eq(schema.issue.cycleId, cycleId),
          isNull(schema.issue.archivedAt),
          sql`${schema.issue.stateId} in ${openStateIds}`,
        ),
      )
      .returning();

    const [closed] = await tx
      .update(schema.cycle)
      .set({
        completedAt: now,
        syncId,
        progressSnapshot: { ...outcomeOf(atClose, rolled.length, now) },
      })
      .where(eq(schema.cycle.id, cycleId))
      .returning();
    const completed = requireRow(closed, 'That cycle does not exist.');

    return {
      cycle: completed,
      nextCycle,
      rolledOverIssueIds: rolled.map((row) => row.id),
      releasedIssueIds: released.map((row) => row.id),
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: cycleScopes(completed),
          action: 'update',
          model: 'cycle',
          modelId: completed.id,
          data: completed,
          actor,
        }),
        ...[...released, ...rolled].map((row) =>
          buildSyncAction({
            syncId,
            organizationId: principal.organizationId,
            scopes: issueScopes(row),
            action: 'update',
            model: 'issue',
            modelId: row.id,
            data: row,
            actor,
          }),
        ),
      ],
    };
  });
}

export async function cycleIssueCount(principal: Principal, cycleId: string): Promise<number> {
  await getCycle(principal, cycleId);
  const [row] = await db
    .select({ total: count() })
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.cycleId, cycleId),
        eq(schema.issue.organizationId, principal.organizationId),
      ),
    );
  return row?.total ?? 0;
}
