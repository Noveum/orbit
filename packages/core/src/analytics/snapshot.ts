import { and, count, db, eq, gt, inArray, isNull, lte, schema, sql } from '@orbit/db';
import type { StateCategory } from '@orbit/shared/constants';
import type { Actor, SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { newId, startOfUtcDay } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

const SNAPSHOT_ACTOR: Actor = { type: 'system', id: 'snapshot', name: 'Cycle snapshot' };

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

export interface SnapshotResult {
  readonly capturedOn: string;
  readonly count: number;
  readonly actions: SyncAction[];
}

export async function writeCycleSnapshots(now: Date = new Date()): Promise<SnapshotResult> {
  const capturedOn = startOfUtcDay(now).toISOString().slice(0, 10);

  const activeCycles = await db
    .select({
      id: schema.cycle.id,
      teamId: schema.cycle.teamId,
      organizationId: schema.cycle.organizationId,
    })
    .from(schema.cycle)
    .where(
      and(
        lte(schema.cycle.startsAt, now),
        gt(schema.cycle.endsAt, now),
        isNull(schema.cycle.completedAt),
        isNull(schema.cycle.archivedAt),
      ),
    );

  if (activeCycles.length === 0) return { capturedOn, count: 0, actions: [] };

  const cycleIds = activeCycles.map((cycle) => cycle.id);
  const rows = await db
    .select({
      cycleId: schema.issue.cycleId,
      category: schema.workflowState.category,
      issues: count(),
      points: sql<number>`coalesce(sum(coalesce(${schema.issue.estimate}, 0)), 0)`,
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(and(inArray(schema.issue.cycleId, cycleIds), isNull(schema.issue.archivedAt)))
    .groupBy(schema.issue.cycleId, schema.workflowState.category);

  const tallies = new Map<string, Tally>();
  for (const id of cycleIds) tallies.set(id, emptyTally());
  for (const row of rows) {
    if (row.cycleId === null) continue;
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
  let written = 0;
  for (const cycle of activeCycles) {
    const tally = tallies.get(cycle.id) ?? emptyTally();
    const syncId = await nextSyncId(db);
    const breakdown = {
      backlog: tally.backlog,
      unstarted: tally.unstarted,
      started: tally.started,
      completed: tally.completed,
      canceled: tally.canceled,
    };
    await db
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
          syncId,
        },
      });
    written += 1;
    actions.push(
      buildSyncAction({
        syncId,
        organizationId: cycle.organizationId,
        scopes: [scopes.organization(cycle.organizationId), scopes.team(cycle.teamId)],
        action: 'update',
        model: 'cycle',
        modelId: cycle.id,
        data: { id: cycle.id, capturedOn, ...breakdown, total: tally.total },
        actor: SNAPSHOT_ACTOR,
        at: now,
      }),
    );
  }

  return { capturedOn, count: written, actions };
}
