import { and, asc, db, desc, eq, gte, inArray, isNull, lte, schema, sql } from '@orbit/db';
import { conflict } from '@orbit/shared/errors';
import type { SyncAction, SyncModel } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import {
  blockerCreateSchema,
  blockerResolveSchema,
  rotationSchema,
  standupListSchema,
  standupOpenSchema,
  standupUpdateSchema,
  turnAdvanceSchema,
  turnFocusSchema,
  turnUpdateSchema,
} from '@orbit/shared/validators';
import { type Executor, newId, requireRow } from '../internal.ts';
import { requireTeam } from '../org/team-service.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { activeCycle } from './cycle-service.ts';

export type StandupRow = typeof schema.standup.$inferSelect;
export type StandupTurnRow = typeof schema.standupTurn.$inferSelect;
export type StandupBlockerRow = typeof schema.standupBlocker.$inferSelect;
export type StandupRotationRow = typeof schema.standupRotation.$inferSelect;

export interface StandupDetail {
  readonly standup: StandupRow;
  readonly turns: readonly StandupTurnRow[];
  readonly blockers: readonly StandupBlockerRow[];
}

function standupScopes(row: Pick<StandupRow, 'organizationId' | 'teamId' | 'id'>): string[] {
  return [scopes.team(row.teamId), scopes.standup(row.id)];
}

function standupAction(
  row: StandupRow,
  syncId: number,
  action: 'insert' | 'update' | 'delete',
  data: Record<string, unknown>,
  model: SyncModel = 'standup',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: standupScopes(row),
    action,
    model,
    modelId: row.id,
    data,
    actor: { type: 'system', id: 'standup' },
  });
}

export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function loadStandup(executor: Executor, principal: Principal, id: string) {
  const [row] = await executor
    .select()
    .from(schema.standup)
    .where(
      and(eq(schema.standup.id, id), eq(schema.standup.organizationId, principal.organizationId)),
    )
    .limit(1);
  return requireRow(row, 'That standup does not exist.');
}

async function turnsOf(executor: Executor, standupId: string): Promise<StandupTurnRow[]> {
  return await executor
    .select()
    .from(schema.standupTurn)
    .where(eq(schema.standupTurn.standupId, standupId))
    .orderBy(asc(schema.standupTurn.position));
}

async function blockersOf(executor: Executor, standupId: string): Promise<StandupBlockerRow[]> {
  return await executor
    .select({
      id: schema.standupBlocker.id,
      organizationId: schema.standupBlocker.organizationId,
      turnId: schema.standupBlocker.turnId,
      issueId: schema.standupBlocker.issueId,
      summary: schema.standupBlocker.summary,
      ownerId: schema.standupBlocker.ownerId,
      resolvedAt: schema.standupBlocker.resolvedAt,
      syncId: schema.standupBlocker.syncId,
      createdAt: schema.standupBlocker.createdAt,
    })
    .from(schema.standupBlocker)
    .innerJoin(schema.standupTurn, eq(schema.standupTurn.id, schema.standupBlocker.turnId))
    .where(eq(schema.standupTurn.standupId, standupId))
    .orderBy(asc(schema.standupBlocker.createdAt));
}

async function detailOf(
  executor: Executor,
  principal: Principal,
  standupId: string,
): Promise<StandupDetail> {
  const standup = await loadStandup(executor, principal, standupId);
  const [turns, blockers] = await Promise.all([
    turnsOf(executor, standupId),
    blockersOf(executor, standupId),
  ]);
  return { standup, turns, blockers };
}

async function teamMemberIds(executor: Executor, teamId: string): Promise<Set<string>> {
  const rows = await executor
    .select({ userId: schema.teamMember.userId })
    .from(schema.teamMember)
    .where(eq(schema.teamMember.teamId, teamId));
  return new Set(rows.map((row) => row.userId));
}

async function assertOnTeam(
  executor: Executor,
  teamId: string,
  userIds: readonly (string | null | undefined)[],
): Promise<void> {
  const wanted = userIds.filter((userId): userId is string => typeof userId === 'string');
  if (wanted.length === 0) return;
  const members = await teamMemberIds(executor, teamId);
  if (wanted.some((userId) => !members.has(userId))) {
    throw conflict('Everyone in a standup has to be on the team.');
  }
}

async function rosterFor(
  executor: Executor,
  teamId: string,
  requested: readonly string[] | undefined,
): Promise<string[]> {
  if (requested !== undefined && requested.length > 0) {
    const members = await teamMemberIds(executor, teamId);
    const outsider = requested.find((userId) => !members.has(userId));
    if (outsider !== undefined) {
      throw conflict('Everyone in a standup has to be on the team.');
    }
    return [...new Set(requested)];
  }

  const rotation = await executor
    .select({ userId: schema.standupRotation.userId })
    .from(schema.standupRotation)
    .where(eq(schema.standupRotation.teamId, teamId))
    .orderBy(asc(schema.standupRotation.position));
  if (rotation.length > 0) return rotation.map((row) => row.userId);

  const members = await executor
    .select({ userId: schema.teamMember.userId })
    .from(schema.teamMember)
    .innerJoin(schema.user, eq(schema.user.id, schema.teamMember.userId))
    .where(eq(schema.teamMember.teamId, teamId))
    .orderBy(asc(schema.user.name));
  return members.map((row) => row.userId);
}

async function nextFacilitator(
  executor: Executor,
  teamId: string,
  roster: readonly string[],
): Promise<string | null> {
  const eligible = await executor
    .select({ userId: schema.standupRotation.userId })
    .from(schema.standupRotation)
    .where(
      and(eq(schema.standupRotation.teamId, teamId), eq(schema.standupRotation.facilitates, 1)),
    )
    .orderBy(asc(schema.standupRotation.position));
  const pool = eligible.length > 0 ? eligible.map((row) => row.userId) : [...roster];
  if (pool.length === 0) return null;

  const [previous] = await executor
    .select({ facilitatorId: schema.standup.facilitatorId })
    .from(schema.standup)
    .where(eq(schema.standup.teamId, teamId))
    .orderBy(desc(schema.standup.heldOn))
    .limit(1);

  const last = previous?.facilitatorId ?? null;
  if (last === null) return pool[0] ?? null;
  const index = pool.indexOf(last);
  return pool[(index + 1) % pool.length] ?? pool[0] ?? null;
}

export async function openStandup(
  principal: Principal,
  input: unknown,
): Promise<{ detail: StandupDetail; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const parsed = standupOpenSchema.parse(input);
  await requireTeam(principal, parsed.teamId);
  const heldOn = parsed.heldOn ?? today();
  const cycle = await activeCycle(principal, parsed.teamId);

  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`standup:${parsed.teamId}:${heldOn}`}))`,
    );
    const [existing] = await tx
      .select()
      .from(schema.standup)
      .where(and(eq(schema.standup.teamId, parsed.teamId), eq(schema.standup.heldOn, heldOn)))
      .limit(1);
    if (existing !== undefined) {
      return { detail: await detailOf(tx, principal, existing.id), actions: [] };
    }

    const roster = await rosterFor(tx, parsed.teamId, parsed.participantIds);
    await assertOnTeam(tx, parsed.teamId, [parsed.facilitatorId]);
    const facilitator =
      parsed.facilitatorId === undefined
        ? await nextFacilitator(tx, parsed.teamId, roster)
        : parsed.facilitatorId;
    const syncId = await nextSyncId(tx);

    const [created] = await tx
      .insert(schema.standup)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        teamId: parsed.teamId,
        cycleId: cycle?.id ?? null,
        heldOn,
        facilitatorId: facilitator,
        status: 'scheduled',
        syncId,
      })
      .returning();
    const standup = requireRow(created, 'The standup could not be opened.');

    if (roster.length > 0) {
      await tx.insert(schema.standupTurn).values(
        roster.map((userId, index) => ({
          id: newId(),
          organizationId: principal.organizationId,
          standupId: standup.id,
          userId,
          position: index,
          syncId,
        })),
      );
    }

    const detail = await detailOf(tx, principal, standup.id);
    return { detail, actions: [standupAction(standup, syncId, 'insert', { ...detail })] };
  });
}

export async function getStandup(principal: Principal, standupId: string): Promise<StandupDetail> {
  assertCan(principal, 'issue:read');
  const detail = await detailOf(db, principal, standupId);
  await requireTeam(principal, detail.standup.teamId);
  return detail;
}

export async function findStandup(
  principal: Principal,
  teamId: string,
  heldOn: string,
): Promise<StandupDetail | null> {
  assertCan(principal, 'issue:read');
  await requireTeam(principal, teamId);
  const [row] = await db
    .select({ id: schema.standup.id })
    .from(schema.standup)
    .where(and(eq(schema.standup.teamId, teamId), eq(schema.standup.heldOn, heldOn)))
    .limit(1);
  if (row === undefined) return null;
  return await detailOf(db, principal, row.id);
}

export async function listStandups(principal: Principal, input: unknown = {}) {
  assertCan(principal, 'issue:read');
  const parsed = standupListSchema.parse(input);
  const filters = [eq(schema.standup.organizationId, principal.organizationId)];
  if (parsed.teamId !== undefined) {
    await requireTeam(principal, parsed.teamId);
    filters.push(eq(schema.standup.teamId, parsed.teamId));
  } else if (principal.role !== 'admin') {
    if (principal.teamIds.length === 0) return [];
    filters.push(inArray(schema.standup.teamId, [...principal.teamIds]));
  }
  if (parsed.cycleId !== undefined) filters.push(eq(schema.standup.cycleId, parsed.cycleId));
  if (parsed.from !== undefined) filters.push(gte(schema.standup.heldOn, parsed.from));
  if (parsed.to !== undefined) filters.push(lte(schema.standup.heldOn, parsed.to));

  return await db
    .select()
    .from(schema.standup)
    .where(and(...filters))
    .orderBy(desc(schema.standup.heldOn))
    .limit(parsed.limit);
}

async function saveStandup(
  tx: Executor,
  principal: Principal,
  standupId: string,
  values: Partial<typeof schema.standup.$inferInsert>,
): Promise<{ detail: StandupDetail; actions: SyncAction[] }> {
  const syncId = await nextSyncId(tx);
  const [updated] = await tx
    .update(schema.standup)
    .set({ ...values, syncId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.standup.id, standupId),
        eq(schema.standup.organizationId, principal.organizationId),
      ),
    )
    .returning();
  const standup = requireRow(updated, 'That standup does not exist.');
  const detail = await detailOf(tx, principal, standup.id);
  return { detail, actions: [standupAction(standup, syncId, 'update', { ...detail })] };
}

export async function updateStandup(
  principal: Principal,
  standupId: string,
  input: unknown,
): Promise<{ detail: StandupDetail; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const parsed = standupUpdateSchema.parse(input);
  const current = await loadStandup(db, principal, standupId);
  await requireTeam(principal, current.teamId);

  const values: Partial<typeof schema.standup.$inferInsert> = {};
  if (parsed.facilitatorId !== undefined) values.facilitatorId = parsed.facilitatorId;
  if (parsed.status !== undefined) values.status = parsed.status;

  return await db.transaction(async (tx) => {
    const locked = await lockStandup(tx, principal, standupId);
    await assertOnTeam(tx, locked.teamId, [parsed.facilitatorId]);
    if (parsed.status === 'running' && locked.startedAt === null) values.startedAt = new Date();
    if (parsed.status === 'finished') {
      const now = new Date();
      await closeSpeakingTurn(tx, await turnsOf(tx, standupId), locked.currentTurnId, now);
      values.endedAt = now;
      values.currentTurnId = null;
    }
    return await saveStandup(tx, principal, standupId, values);
  });
}

export async function startStandup(
  principal: Principal,
  standupId: string,
): Promise<{ detail: StandupDetail; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const current = await loadStandup(db, principal, standupId);
  await requireTeam(principal, current.teamId);
  if (current.status === 'finished') throw conflict('That standup has already finished.');

  return await db.transaction(async (tx) => {
    const locked = await lockStandup(tx, principal, standupId);
    if (locked.status === 'finished') throw conflict('That standup has already finished.');
    const now = new Date();
    const turns = await turnsOf(tx, standupId);
    const first = turns.find((turn) => turn.attendance !== 'absent') ?? turns[0];
    if (first !== undefined) await activateTurn(tx, first, now);
    return await saveStandup(tx, principal, standupId, {
      status: 'running',
      startedAt: locked.startedAt ?? now,
      currentTurnId: locked.currentTurnId ?? first?.id ?? null,
    });
  });
}

async function lockStandup(tx: Executor, principal: Principal, id: string) {
  const [row] = await tx
    .select()
    .from(schema.standup)
    .where(
      and(eq(schema.standup.id, id), eq(schema.standup.organizationId, principal.organizationId)),
    )
    .limit(1)
    .for('update');
  return requireRow(row, 'That standup does not exist.');
}

function accumulatedSeconds(turn: StandupTurnRow, now: Date): number | null {
  if (turn.spokeAt === null) return turn.durationSeconds;
  const elapsed = Math.max(0, Math.round((now.getTime() - turn.spokeAt.getTime()) / 1000));
  return (turn.durationSeconds ?? 0) + elapsed;
}

async function activateTurn(tx: Executor, turn: StandupTurnRow, now: Date): Promise<void> {
  const alreadySpeaking = turn.status === 'speaking' && turn.spokeAt !== null;
  await tx
    .update(schema.standupTurn)
    .set({
      status: 'speaking',
      spokeAt: alreadySpeaking ? turn.spokeAt : now,
      updatedAt: now,
    })
    .where(eq(schema.standupTurn.id, turn.id));
}

async function closeSpeakingTurn(
  tx: Executor,
  turns: readonly StandupTurnRow[],
  currentTurnId: string | null,
  now: Date,
): Promise<void> {
  if (currentTurnId === null) return;
  const speaking = turns.find((turn) => turn.id === currentTurnId);
  if (speaking === undefined || speaking.status !== 'speaking') return;
  await tx
    .update(schema.standupTurn)
    .set({
      status: 'done',
      durationSeconds: accumulatedSeconds(speaking, now),
      attendance: speaking.attendance === 'unknown' ? 'present' : speaking.attendance,
      updatedAt: now,
    })
    .where(eq(schema.standupTurn.id, speaking.id));
}

function nextTurnIndex(
  turns: readonly StandupTurnRow[],
  currentId: string | null,
  direction: 'next' | 'previous',
): number {
  const index = currentId === null ? -1 : turns.findIndex((turn) => turn.id === currentId);
  const step = direction === 'next' ? 1 : -1;
  let cursor = index + step;
  while (cursor >= 0 && cursor < turns.length) {
    const candidate = turns[cursor];
    if (candidate !== undefined && candidate.attendance !== 'absent') return cursor;
    cursor += step;
  }
  return -1;
}

export async function advanceStandup(
  principal: Principal,
  standupId: string,
  input: unknown = {},
): Promise<{ detail: StandupDetail; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const parsed = turnAdvanceSchema.parse(input);
  const current = await loadStandup(db, principal, standupId);
  await requireTeam(principal, current.teamId);

  return await db.transaction(async (tx) => {
    const locked = await lockStandup(tx, principal, standupId);
    const turns = await turnsOf(tx, standupId);
    const now = new Date();

    if (parsed.markDone) await closeSpeakingTurn(tx, turns, locked.currentTurnId, now);

    const index = nextTurnIndex(turns, locked.currentTurnId, parsed.direction);
    const target = index === -1 ? undefined : turns[index];

    if (target !== undefined) await activateTurn(tx, target, now);

    const ending = target === undefined && parsed.direction === 'next';
    return await saveStandup(tx, principal, standupId, {
      currentTurnId: target?.id ?? null,
      ...(ending ? { status: 'finished', endedAt: now } : {}),
    });
  });
}

export async function focusTurn(
  principal: Principal,
  standupId: string,
  input: unknown,
): Promise<{ detail: StandupDetail; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const parsed = turnFocusSchema.parse(input);
  const current = await loadStandup(db, principal, standupId);
  await requireTeam(principal, current.teamId);

  return await db.transaction(async (tx) => {
    const locked = await lockStandup(tx, principal, standupId);
    const now = new Date();
    const turns = await turnsOf(tx, standupId);
    if (locked.currentTurnId !== parsed.turnId) {
      await closeSpeakingTurn(tx, turns, locked.currentTurnId, now);
    }
    const target = requireRow(
      turns.find((turn) => turn.id === parsed.turnId),
      'That turn does not belong to this standup.',
    );
    await activateTurn(tx, target, now);
    return await saveStandup(tx, principal, standupId, { currentTurnId: parsed.turnId });
  });
}

export async function updateTurn(
  principal: Principal,
  standupId: string,
  turnId: string,
  input: unknown,
): Promise<{ detail: StandupDetail; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const parsed = turnUpdateSchema.parse(input);
  const current = await loadStandup(db, principal, standupId);
  await requireTeam(principal, current.teamId);

  return await db.transaction(async (tx) => {
    const locked = await lockStandup(tx, principal, standupId);
    const values: Partial<typeof schema.standupTurn.$inferInsert> = { updatedAt: new Date() };
    if (parsed.attendance !== undefined) values.attendance = parsed.attendance;
    if (parsed.status !== undefined) values.status = parsed.status;
    if (parsed.notes !== undefined) values.notes = parsed.notes;
    if (parsed.blockers !== undefined) values.blockers = parsed.blockers;

    const [updated] = await tx
      .update(schema.standupTurn)
      .set(values)
      .where(and(eq(schema.standupTurn.id, turnId), eq(schema.standupTurn.standupId, standupId)))
      .returning({ id: schema.standupTurn.id });
    requireRow(updated, 'That turn does not belong to this standup.');

    if (parsed.attendance !== 'absent' || locked.currentTurnId !== turnId) {
      return await saveStandup(tx, principal, standupId, {});
    }

    const turns = await turnsOf(tx, standupId);
    const index = nextTurnIndex(turns, turnId, 'next');
    const target = index === -1 ? undefined : turns[index];
    const now = new Date();
    await tx
      .update(schema.standupTurn)
      .set({ status: 'skipped', updatedAt: now })
      .where(eq(schema.standupTurn.id, turnId));
    if (target !== undefined) await activateTurn(tx, target, now);
    return await saveStandup(tx, principal, standupId, {
      currentTurnId: target?.id ?? null,
      ...(target === undefined ? { status: 'finished', endedAt: now } : {}),
    });
  });
}

export async function addBlocker(
  principal: Principal,
  standupId: string,
  turnId: string,
  input: unknown,
): Promise<{ detail: StandupDetail; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const parsed = blockerCreateSchema.parse(input);
  const current = await loadStandup(db, principal, standupId);
  await requireTeam(principal, current.teamId);

  return await db.transaction(async (tx) => {
    const [turn] = await tx
      .select({ id: schema.standupTurn.id })
      .from(schema.standupTurn)
      .where(and(eq(schema.standupTurn.id, turnId), eq(schema.standupTurn.standupId, standupId)))
      .limit(1);
    requireRow(turn, 'That turn does not belong to this standup.');

    await tx.insert(schema.standupBlocker).values({
      id: newId(),
      organizationId: principal.organizationId,
      turnId,
      issueId: parsed.issueId ?? null,
      summary: parsed.summary,
      ownerId: parsed.ownerId ?? null,
      syncId: await nextSyncId(tx),
    });
    return await saveStandup(tx, principal, standupId, {});
  });
}

export async function resolveBlocker(
  principal: Principal,
  standupId: string,
  blockerId: string,
  input: unknown = {},
): Promise<{ detail: StandupDetail; actions: SyncAction[] }> {
  assertCan(principal, 'issue:update');
  const parsed = blockerResolveSchema.parse(input);
  const current = await loadStandup(db, principal, standupId);
  await requireTeam(principal, current.teamId);

  return await db.transaction(async (tx) => {
    const owned = tx
      .select({ id: schema.standupBlocker.id })
      .from(schema.standupBlocker)
      .innerJoin(schema.standupTurn, eq(schema.standupTurn.id, schema.standupBlocker.turnId))
      .where(
        and(eq(schema.standupBlocker.id, blockerId), eq(schema.standupTurn.standupId, standupId)),
      );
    const [updated] = await tx
      .update(schema.standupBlocker)
      .set({ resolvedAt: parsed.resolved ? new Date() : null })
      .where(
        and(
          inArray(schema.standupBlocker.id, owned),
          eq(schema.standupBlocker.organizationId, principal.organizationId),
        ),
      )
      .returning({ id: schema.standupBlocker.id });
    requireRow(updated, 'That blocker does not exist.');
    return await saveStandup(tx, principal, standupId, {});
  });
}

export async function openBlockers(
  principal: Principal,
  teamId: string,
): Promise<StandupBlockerRow[]> {
  assertCan(principal, 'issue:read');
  await requireTeam(principal, teamId);
  return await db
    .select({
      id: schema.standupBlocker.id,
      organizationId: schema.standupBlocker.organizationId,
      turnId: schema.standupBlocker.turnId,
      issueId: schema.standupBlocker.issueId,
      summary: schema.standupBlocker.summary,
      ownerId: schema.standupBlocker.ownerId,
      resolvedAt: schema.standupBlocker.resolvedAt,
      syncId: schema.standupBlocker.syncId,
      createdAt: schema.standupBlocker.createdAt,
    })
    .from(schema.standupBlocker)
    .innerJoin(schema.standupTurn, eq(schema.standupTurn.id, schema.standupBlocker.turnId))
    .innerJoin(schema.standup, eq(schema.standup.id, schema.standupTurn.standupId))
    .where(and(eq(schema.standup.teamId, teamId), isNull(schema.standupBlocker.resolvedAt)))
    .orderBy(desc(schema.standupBlocker.createdAt));
}

export async function setRotation(
  principal: Principal,
  input: unknown,
): Promise<StandupRotationRow[]> {
  assertCan(principal, 'team:manage');
  const parsed = rotationSchema.parse(input);
  await requireTeam(principal, parsed.teamId);

  return await db.transaction(async (tx) => {
    await assertOnTeam(
      tx,
      parsed.teamId,
      parsed.members.map((member) => member.userId),
    );
    await tx.delete(schema.standupRotation).where(eq(schema.standupRotation.teamId, parsed.teamId));
    if (parsed.members.length === 0) return [];
    const syncId = await nextSyncId(tx);
    return await tx
      .insert(schema.standupRotation)
      .values(
        parsed.members.map((member, index) => ({
          id: newId(),
          organizationId: principal.organizationId,
          teamId: parsed.teamId,
          userId: member.userId,
          position: index,
          facilitates: member.facilitates ? 1 : 0,
          syncId,
        })),
      )
      .returning();
  });
}

export async function getRotation(
  principal: Principal,
  teamId: string,
): Promise<StandupRotationRow[]> {
  assertCan(principal, 'issue:read');
  await requireTeam(principal, teamId);
  return await db
    .select()
    .from(schema.standupRotation)
    .where(eq(schema.standupRotation.teamId, teamId))
    .orderBy(asc(schema.standupRotation.position));
}

export interface StandupWorkload {
  readonly userId: string;
  readonly inProgress: number;
  readonly completedSinceLast: number;
  readonly assigned: number;
}

export async function standupWorkload(
  principal: Principal,
  teamId: string,
  since: Date,
): Promise<StandupWorkload[]> {
  assertCan(principal, 'issue:read');
  await requireTeam(principal, teamId);

  const rows = await db
    .select({
      userId: schema.issue.assigneeId,
      assigned: sql<number>`count(*)`.as('assigned'),
      inProgress:
        sql<number>`count(*) filter (where ${schema.workflowState.category} in ('started', 'review'))`.as(
          'in_progress',
        ),
      completedSinceLast:
        sql<number>`count(*) filter (where ${schema.issue.completedAt} >= ${since.toISOString()}::timestamptz)`.as(
          'completed_since_last',
        ),
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(and(eq(schema.issue.teamId, teamId), isNull(schema.issue.archivedAt)))
    .groupBy(schema.issue.assigneeId);

  return rows.flatMap((row) =>
    row.userId === null
      ? []
      : [
          {
            userId: row.userId,
            assigned: Number(row.assigned),
            inProgress: Number(row.inProgress),
            completedSinceLast: Number(row.completedSinceLast),
          },
        ],
  );
}
