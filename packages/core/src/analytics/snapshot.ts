import type { Transaction } from '@orbit/db';
import { and, count, db, eq, gt, isNull, lte, or, schema, sql } from '@orbit/db';
import type { StateCategory } from '@orbit/shared/constants';
import type { Actor, SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { newId } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { bootstrapActiveCycleMemberships, bootstrapCycleMemberships } from './membership.ts';

const SNAPSHOT_ACTOR: Actor = { type: 'system', id: 'snapshot', name: 'Sprint snapshot' };

interface Tally {
  total: number;
  backlog: number;
  unstarted: number;
  started: number;
  completed: number;
  canceled: number;
  totalEstimate: number;
  completedEstimate: number;
}

function emptyTally(): Tally {
  return {
    total: 0,
    backlog: 0,
    unstarted: 0,
    started: 0,
    completed: 0,
    canceled: 0,
    totalEstimate: 0,
    completedEstimate: 0,
  };
}

function bucketFor(category: StateCategory): keyof Tally {
  switch (category) {
    case 'triage':
    case 'backlog':
      return 'backlog';
    case 'unstarted':
      return 'unstarted';
    case 'started':
    case 'review':
      return 'started';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'canceled';
    default:
      return 'unstarted';
  }
}

function localDate(now: Date, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
  }
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not resolve a local date for ${timezone}.`);
  }
  return `${year}-${month}-${day}`;
}

export interface WriteCycleSnapshotsInput {
  readonly now: Date;
  readonly finalCycleId?: string;
}

export interface SnapshotResult {
  readonly captured: number;
  readonly actions: SyncAction[];
}

export async function writeCycleSnapshotsInTransaction(
  tx: Transaction,
  input: WriteCycleSnapshotsInput,
): Promise<SnapshotResult> {
  if (input.finalCycleId === undefined) {
    await bootstrapActiveCycleMemberships(tx, input.now);
  } else {
    await bootstrapCycleMemberships(tx, [input.finalCycleId], input.now);
  }

  const activeCycles = await tx
    .select({
      id: schema.cycle.id,
      organizationId: schema.cycle.organizationId,
      timezone: schema.cycle.timezone,
    })
    .from(schema.cycle)
    .where(
      and(
        isNull(schema.cycle.completedAt),
        isNull(schema.cycle.archivedAt),
        input.finalCycleId === undefined
          ? and(lte(schema.cycle.startsAt, input.now), gt(schema.cycle.endsAt, input.now))
          : eq(schema.cycle.id, input.finalCycleId),
      ),
    );

  if (activeCycles.length === 0) return { captured: 0, actions: [] };

  const cycleIds = activeCycles.map((cycle) => cycle.id);
  const issueMatchesCycle = or(
    ...activeCycles.map((cycle) =>
      and(
        eq(schema.issue.cycleId, cycle.id),
        eq(schema.issue.organizationId, cycle.organizationId),
      ),
    ),
  );
  const rows = await tx
    .select({
      organizationId: schema.issue.organizationId,
      cycleId: schema.issue.cycleId,
      category: schema.workflowState.category,
      issues: count(),
      points: sql<number>`coalesce(sum(coalesce(${schema.issue.estimate}, 0)), 0)`,
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(
      and(
        issueMatchesCycle,
        eq(schema.workflowState.organizationId, schema.issue.organizationId),
        eq(schema.workflowState.teamId, schema.issue.teamId),
        isNull(schema.issue.archivedAt),
      ),
    )
    .groupBy(schema.issue.organizationId, schema.issue.cycleId, schema.workflowState.category);

  const cyclesById = new Map(activeCycles.map((cycle) => [cycle.id, cycle]));
  const tallies = new Map<string, Tally>();
  for (const id of cycleIds) tallies.set(id, emptyTally());
  for (const row of rows) {
    if (row.cycleId === null) continue;
    const cycle = cyclesById.get(row.cycleId);
    if (cycle === undefined || cycle.organizationId !== row.organizationId) continue;
    const tally = tallies.get(row.cycleId);
    if (tally === undefined) continue;
    const issues = Number(row.issues);
    const points = Number(row.points);
    tally.total += issues;
    tally.totalEstimate += points;
    tally[bucketFor(row.category as StateCategory)] += issues;
    if (row.category === 'completed') tally.completedEstimate += points;
  }

  const actions: SyncAction[] = [];
  for (const cycle of activeCycles) {
    const capturedOn = localDate(input.now, cycle.timezone);
    const tally = tallies.get(cycle.id) ?? emptyTally();
    const syncId = await nextSyncId(tx);
    const breakdown = {
      backlog: tally.backlog,
      unstarted: tally.unstarted,
      started: tally.started,
      completed: tally.completed,
      canceled: tally.canceled,
    };
    const isFinal = cycle.id === input.finalCycleId;
    await tx
      .insert(schema.cycleProgressSnapshot)
      .values({
        id: newId(),
        organizationId: cycle.organizationId,
        cycleId: cycle.id,
        capturedOn,
        totalIssues: tally.total,
        backlogIssues: tally.backlog,
        unstartedIssues: tally.unstarted,
        startedIssues: tally.started,
        completedIssues: tally.completed,
        canceledIssues: tally.canceled,
        totalEstimate: tally.totalEstimate,
        completedEstimate: tally.completedEstimate,
        breakdown,
        capturedAt: input.now,
        isFinal,
        syncId,
      })
      .onConflictDoUpdate({
        target: [schema.cycleProgressSnapshot.cycleId, schema.cycleProgressSnapshot.capturedOn],
        set: {
          totalIssues: tally.total,
          backlogIssues: tally.backlog,
          unstartedIssues: tally.unstarted,
          startedIssues: tally.started,
          completedIssues: tally.completed,
          canceledIssues: tally.canceled,
          totalEstimate: tally.totalEstimate,
          completedEstimate: tally.completedEstimate,
          breakdown,
          capturedAt: input.now,
          isFinal: sql`${schema.cycleProgressSnapshot.isFinal} or excluded.is_final`,
          syncId,
        },
      });
    actions.push(
      buildSyncAction({
        syncId,
        organizationId: cycle.organizationId,
        scopes: [scopes.organization(cycle.organizationId)],
        action: 'update',
        model: 'cycle',
        modelId: cycle.id,
        data: { id: cycle.id, capturedOn, isFinal, ...breakdown, total: tally.total },
        actor: SNAPSHOT_ACTOR,
        at: input.now,
      }),
    );
  }

  return { captured: activeCycles.length, actions };
}

export async function writeCycleSnapshots(
  input: WriteCycleSnapshotsInput = { now: new Date() },
): Promise<SnapshotResult> {
  return await db.transaction(async (tx) => await writeCycleSnapshotsInTransaction(tx, input));
}
