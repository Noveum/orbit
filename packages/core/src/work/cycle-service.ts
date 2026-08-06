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
import { assertCan, assertInTeam, teamScope } from '@orbit/shared/policy';
import { cycleCreateSchema, cycleUpdateSchema } from '@orbit/shared/validators';
import { z } from 'zod';
import { principalActor } from '../activity/activity-service.ts';
import { addUtcDays, type Executor, newId, requireRow, startOfUtcDay } from '../internal.ts';
import { requireTeam } from '../org/team-service.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { issueScopes } from './issue-service.ts';

export type CycleRow = typeof schema.cycle.$inferSelect;

function cycleScopes(row: CycleRow): string[] {
  return [scopes.team(row.teamId)];
}

async function assertCycleWindow(
  executor: Executor,
  window: { teamId: string; startsAt: Date; endsAt: Date; excludingCycleId: string | null },
): Promise<void> {
  if (window.endsAt.getTime() <= window.startsAt.getTime()) {
    throw conflict('A cycle has to end after it starts.');
  }
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${`cycle:${window.teamId}`}))`);
  const [clash] = await executor
    .select({ id: schema.cycle.id, name: schema.cycle.name })
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.teamId, window.teamId),
        isNull(schema.cycle.archivedAt),
        lt(schema.cycle.startsAt, window.endsAt),
        gt(schema.cycle.endsAt, window.startsAt),
        window.excludingCycleId === null ? undefined : ne(schema.cycle.id, window.excludingCycleId),
      ),
    )
    .limit(1);
  if (clash !== undefined) {
    throw conflict(`Those dates overlap ${clash.name}.`, { details: { cycleId: clash.id } });
  }
}

async function nextCycleNumber(executor: Executor, teamId: string): Promise<number> {
  const [row] = await executor
    .select({ number: schema.cycle.number })
    .from(schema.cycle)
    .where(eq(schema.cycle.teamId, teamId))
    .orderBy(desc(schema.cycle.number))
    .limit(1);
  return (row?.number ?? 0) + 1;
}

export async function createCycle(
  principal: Principal,
  input: unknown,
): Promise<{ cycle: CycleRow; actions: SyncAction[] }> {
  assertCan(principal, 'cycle:manage');
  const parsed = cycleCreateSchema.parse(input);
  return await db.transaction(async (tx) => {
    const team = await requireTeam(principal, parsed.teamId, tx);
    await assertCycleWindow(tx, {
      teamId: parsed.teamId,
      startsAt: parsed.startsAt,
      endsAt: parsed.endsAt,
      excludingCycleId: null,
    });
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const number = await nextCycleNumber(tx, team.id);
    const [created] = await tx
      .insert(schema.cycle)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        teamId: team.id,
        number,
        name: parsed.name ?? `Sprint ${number}`,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
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

export async function updateCycle(
  principal: Principal,
  cycleId: string,
  input: unknown,
): Promise<{ cycle: CycleRow; actions: SyncAction[] }> {
  assertCan(principal, 'cycle:manage');
  const parsed = cycleUpdateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(schema.cycle)
      .where(
        and(
          eq(schema.cycle.id, cycleId),
          eq(schema.cycle.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const current = requireRow(found, 'That cycle does not exist.');
    assertInTeam(principal, teamScope(current));

    const values: Partial<typeof schema.cycle.$inferInsert> = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.startsAt !== undefined) values.startsAt = parsed.startsAt;
    if (parsed.endsAt !== undefined) values.endsAt = parsed.endsAt;

    if (parsed.startsAt !== undefined || parsed.endsAt !== undefined) {
      await assertCycleWindow(tx, {
        teamId: current.teamId,
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
    const [existing] = await tx
      .select()
      .from(schema.cycle)
      .where(
        and(
          eq(schema.cycle.id, cycleId),
          eq(schema.cycle.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const cycle = requireRow(existing, 'That cycle does not exist.');
    assertInTeam(principal, teamScope(cycle));

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

export async function listCycles(principal: Principal, teamId: string): Promise<CycleRow[]> {
  assertCan(principal, 'issue:read');
  await requireTeam(principal, teamId);
  return await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.teamId, teamId),
        eq(schema.cycle.organizationId, principal.organizationId),
      ),
    )
    .orderBy(asc(schema.cycle.number));
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
  const cycle = requireRow(row, 'That cycle does not exist.');
  assertInTeam(principal, teamScope(cycle));
  return cycle;
}

export async function activeCycle(
  principal: Principal,
  teamId: string,
  now: Date = new Date(),
): Promise<CycleRow | undefined> {
  assertCan(principal, 'issue:read');
  await requireTeam(principal, teamId);
  const [row] = await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.teamId, teamId),
        eq(schema.cycle.organizationId, principal.organizationId),
        lte(schema.cycle.startsAt, now),
        gt(schema.cycle.endsAt, now),
        isNull(schema.cycle.completedAt),
      ),
    )
    .orderBy(asc(schema.cycle.startsAt))
    .limit(1);
  return row;
}

export async function upcomingCycles(
  principal: Principal,
  teamId: string,
  options: { now?: Date; limit?: number } = {},
): Promise<CycleRow[]> {
  assertCan(principal, 'issue:read');
  await requireTeam(principal, teamId);
  return await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.teamId, teamId),
        eq(schema.cycle.organizationId, principal.organizationId),
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

export interface CycleProgress {
  readonly cycleId: string;
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
  readonly canceled: number;
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
  if (issue.category !== 'canceled') return false;
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

function currentTotals(
  issues: ReadonlyMap<string, CycleIssueFacts>,
): Pick<CycleProgress, 'scope' | 'started' | 'completed' | 'canceled' | 'estimated' | 'points'> {
  const members = [...issues.values()].filter((issue) => issue.member);
  const inScope = members.filter((issue) => issue.category !== 'canceled');
  const started = inScope.filter(
    (issue) => issue.category === 'started' || issue.category === 'review',
  );
  const completed = inScope.filter((issue) => issue.category === 'completed');
  return {
    scope: inScope.length,
    started: started.length,
    completed: completed.length,
    canceled: members.length - inScope.length,
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

export async function pastCycles(
  principal: Principal,
  teamId: string,
  limit = 12,
): Promise<CycleRow[]> {
  assertCan(principal, 'project:read');
  await requireTeam(principal, teamId);
  return await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.teamId, teamId),
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
  teamId: string,
  number: number,
): Promise<CycleRow | null> {
  assertCan(principal, 'project:read');
  await requireTeam(principal, teamId);
  const [row] = await db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.teamId, teamId),
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
    const [found] = await tx
      .select()
      .from(schema.cycle)
      .where(
        and(
          eq(schema.cycle.id, cycleId),
          eq(schema.cycle.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const cycle = requireRow(found, 'That cycle does not exist.');
    assertInTeam(principal, teamScope(cycle));
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cycle:${cycle.teamId}`}))`);

    const [locked] = await tx
      .select({ completedAt: schema.cycle.completedAt })
      .from(schema.cycle)
      .where(eq(schema.cycle.id, cycleId))
      .limit(1);
    if (requireRow(locked, 'That cycle does not exist.').completedAt !== null) {
      throw conflict('That cycle is already complete.');
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);

    const [existingNext] = await tx
      .select()
      .from(schema.cycle)
      .where(
        and(
          eq(schema.cycle.teamId, cycle.teamId),
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
        .where(and(eq(schema.cycle.teamId, cycle.teamId), isNull(schema.cycle.archivedAt)))
        .orderBy(desc(schema.cycle.endsAt))
        .limit(1);
      const [highest] = await tx
        .select({ number: schema.cycle.number })
        .from(schema.cycle)
        .where(eq(schema.cycle.teamId, cycle.teamId))
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
          teamId: cycle.teamId,
          number,
          name: `Sprint ${number}`,
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
          eq(schema.workflowState.teamId, cycle.teamId),
          sql`${schema.workflowState.category} not in ('completed', 'canceled')`,
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
        ...rolled.map((row) =>
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
