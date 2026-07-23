import { and, asc, count, db, desc, eq, gt, isNull, lte, schema, sql } from '@orbit/db';
import { conflict } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, assertInTeam, teamScope } from '@orbit/shared/policy';
import { cycleCreateSchema, cycleUpdateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { addUtcDays, type Executor, newId, requireRow, startOfUtcDay } from '../internal.ts';
import { requireTeam } from '../org/team-service.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type CycleRow = typeof schema.cycle.$inferSelect;

function cycleScopes(row: CycleRow): string[] {
  return [scopes.organization(row.organizationId), scopes.team(row.teamId)];
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
  if (parsed.endsAt.getTime() <= parsed.startsAt.getTime()) {
    throw conflict('A cycle has to end after it starts.');
  }

  return await db.transaction(async (tx) => {
    const team = await requireTeam(principal, parsed.teamId, tx);
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
        name: parsed.name ?? `Cycle ${number}`,
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
    const values: Partial<typeof schema.cycle.$inferInsert> = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.startsAt !== undefined) values.startsAt = parsed.startsAt;
    if (parsed.endsAt !== undefined) values.endsAt = parsed.endsAt;

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

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
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
  readonly completed: number;
}

export interface CycleProgress {
  readonly cycleId: string;
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
  readonly burnUp: BurnUpPoint[];
}

const CYCLE_CATEGORY = sql<string>`${schema.workflowState.category}`;

export async function cycleProgress(
  principal: Principal,
  cycleId: string,
  now: Date = new Date(),
): Promise<CycleProgress> {
  const cycle = await getCycle(principal, cycleId);

  const rows = await db
    .select({
      id: schema.issue.id,
      completedAt: schema.issue.completedAt,
      category: CYCLE_CATEGORY,
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(and(eq(schema.issue.cycleId, cycleId), isNull(schema.issue.archivedAt)));

  const scope = rows.length;
  const started = rows.filter(
    (row) => row.category === 'started' || row.category === 'review',
  ).length;
  const completedRows = rows.filter((row) => row.category === 'completed');

  const burnUp: BurnUpPoint[] = [];
  const start = startOfUtcDay(cycle.startsAt);
  const finish = startOfUtcDay(now < cycle.endsAt ? now : cycle.endsAt);
  for (let day = start; day <= finish; day = addUtcDays(day, 1)) {
    const cutoff = addUtcDays(day, 1).getTime();
    burnUp.push({
      date: day.toISOString().slice(0, 10),
      completed: completedRows.filter(
        (row) => row.completedAt !== null && row.completedAt.getTime() < cutoff,
      ).length,
    });
  }

  return { cycleId, scope, started, completed: completedRows.length, burnUp };
}

export interface CompletedCycle {
  readonly cycle: CycleRow;
  readonly nextCycle: CycleRow;
  readonly rolledOverIssueIds: string[];
  readonly actions: SyncAction[];
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
    if (cycle.completedAt !== null) throw conflict('That cycle is already complete.');

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);

    const [existingNext] = await tx
      .select()
      .from(schema.cycle)
      .where(and(eq(schema.cycle.teamId, cycle.teamId), gt(schema.cycle.number, cycle.number)))
      .orderBy(asc(schema.cycle.number))
      .limit(1);

    let nextCycle = existingNext;
    if (nextCycle === undefined) {
      const number = cycle.number + 1;
      const [created] = await tx
        .insert(schema.cycle)
        .values({
          id: newId(),
          organizationId: cycle.organizationId,
          teamId: cycle.teamId,
          number,
          name: `Cycle ${number}`,
          startsAt: cycle.endsAt,
          endsAt: addUtcDays(cycle.endsAt, 14),
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
      .set({ completedAt: now, syncId })
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
            scopes: [
              scopes.organization(principal.organizationId),
              scopes.team(row.teamId),
              scopes.issue(row.id),
            ],
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
