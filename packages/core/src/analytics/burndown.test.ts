import { beforeEach, describe, expect, it } from 'bun:test';
import { db, schema } from '@orbit/db';
import { newId } from '../internal.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import { cycleBurndown, cycleChurn, cycleFlowMetrics, teamVelocity } from './burndown.ts';
import { insertIssue, utc } from './test-fixtures.ts';

let workspace: Workspace;
let cycleId: string;

const START = utc('2026-01-01T00:00:00Z');
const END = utc('2026-01-08T00:00:00Z');

async function makeCycle(): Promise<string> {
  const id = newId();
  await db.insert(schema.cycle).values({
    id,
    organizationId: workspace.organizationId,
    teamId: workspace.teamId,
    number: 90,
    name: 'Fixture cycle',
    startsAt: START,
    endsAt: END,
  });
  return id;
}

function referenceCumulative(completionDays: readonly string[], days: readonly string[]): number[] {
  return days.map((day) => completionDays.filter((completed) => completed <= day).length);
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  cycleId = await makeCycle();
});

describe('cycleBurndown', () => {
  it('matches the reference cumulative completion series and nulls the future', async () => {
    await insertIssue(workspace, {
      number: 1,
      state: 'Done',
      cycleId,
      createdAt: START,
      completedAt: utc('2026-01-02T09:00:00Z'),
    });
    await insertIssue(workspace, {
      number: 2,
      state: 'Done',
      cycleId,
      createdAt: START,
      completedAt: utc('2026-01-03T09:00:00Z'),
    });
    await insertIssue(workspace, {
      number: 3,
      state: 'Done',
      cycleId,
      createdAt: START,
      completedAt: utc('2026-01-05T09:00:00Z'),
    });
    await insertIssue(workspace, {
      number: 4,
      state: 'In Progress',
      cycleId,
      createdAt: START,
      startedAt: utc('2026-01-02T00:00:00Z'),
    });

    const burndown = await cycleBurndown(
      workspace.admin,
      cycleId,
      'issues',
      utc('2026-01-08T12:00:00Z'),
    );
    const days = burndown.points.map((point) => point.date);
    expect(days).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
    ]);

    const reference = referenceCumulative(['2026-01-02', '2026-01-03', '2026-01-05'], days);
    expect(burndown.points.map((point) => point.completed)).toEqual(reference);
    expect(burndown.points.every((point) => point.scope === 4)).toBe(true);
    expect(burndown.points.map((point) => point.remaining)).toEqual([4, 3, 2, 2, 1, 1, 1, 1]);
    expect(burndown.scopeCurrent).toBe(4);
    expect(burndown.completedCurrent).toBe(3);
  });

  it('nulls actual data beyond today while keeping the ideal line', async () => {
    await insertIssue(workspace, {
      number: 1,
      state: 'Done',
      cycleId,
      createdAt: START,
      completedAt: utc('2026-01-02T09:00:00Z'),
    });
    const burndown = await cycleBurndown(
      workspace.admin,
      cycleId,
      'issues',
      utc('2026-01-04T00:00:00Z'),
    );
    const future = burndown.points.filter((point) => point.date > '2026-01-04');
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((point) => point.completed === null && point.remaining === null)).toBe(
      true,
    );
    expect(future.every((point) => point.isFuture)).toBe(true);
    expect(burndown.points.every((point) => Number.isFinite(point.ideal))).toBe(true);
  });

  it('moves the scope line when an issue is added mid cycle', async () => {
    await insertIssue(workspace, { number: 1, state: 'Todo', cycleId, createdAt: START });
    await insertIssue(workspace, { number: 2, state: 'Todo', cycleId, createdAt: START });
    await insertIssue(workspace, { number: 3, state: 'Todo', cycleId, createdAt: START });
    await insertIssue(workspace, { number: 4, state: 'Todo', cycleId, createdAt: START });
    await insertIssue(workspace, {
      number: 5,
      state: 'Todo',
      cycleId,
      createdAt: utc('2026-01-04T10:00:00Z'),
    });

    const burndown = await cycleBurndown(
      workspace.admin,
      cycleId,
      'issues',
      utc('2026-01-08T12:00:00Z'),
    );
    expect(burndown.points[0]?.scope).toBe(4);
    expect(burndown.points[2]?.scope).toBe(4);
    expect(burndown.points[3]?.scope).toBe(5);
    expect(burndown.points.at(-1)?.scope).toBe(5);
    const idealJan4 = burndown.points[3]?.ideal ?? 0;
    expect(idealJan4).toBeCloseTo((5 * (7 - 3)) / 7, 5);
  });

  it('counts issues created before the cycle from day zero', async () => {
    await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: utc('2025-11-20T00:00:00Z'),
    });
    await insertIssue(workspace, {
      number: 2,
      state: 'Todo',
      cycleId,
      createdAt: utc('2025-12-30T00:00:00Z'),
    });
    await insertIssue(workspace, {
      number: 3,
      state: 'Todo',
      cycleId,
      createdAt: utc('2026-01-04T10:00:00Z'),
    });

    const burndown = await cycleBurndown(
      workspace.admin,
      cycleId,
      'issues',
      utc('2026-01-08T12:00:00Z'),
    );
    expect(burndown.points[0]?.scope).toBe(2);
    expect(burndown.points[2]?.scope).toBe(2);
    expect(burndown.points[3]?.scope).toBe(3);
    expect(burndown.scopeStart).toBe(2);
    expect(burndown.scopeCurrent).toBe(3);
  });

  it('measures points when asked', async () => {
    await insertIssue(workspace, {
      number: 1,
      state: 'Done',
      cycleId,
      estimate: 5,
      createdAt: START,
      completedAt: utc('2026-01-02T09:00:00Z'),
    });
    await insertIssue(workspace, {
      number: 2,
      state: 'Todo',
      cycleId,
      estimate: 3,
      createdAt: START,
    });
    const burndown = await cycleBurndown(
      workspace.admin,
      cycleId,
      'points',
      utc('2026-01-08T12:00:00Z'),
    );
    expect(burndown.scopeCurrent).toBe(8);
    expect(burndown.completedCurrent).toBe(5);
  });
});

describe('cycleChurn', () => {
  it('derives added and removed work from snapshot deltas', async () => {
    const totals = [10, 10, 13, 11];
    for (const [index, total] of totals.entries()) {
      await db.insert(schema.cycleProgressSnapshot).values({
        id: newId(),
        organizationId: workspace.organizationId,
        cycleId,
        capturedOn: `2026-01-0${index + 1}`,
        totalIssues: total,
      });
    }
    const churn = await cycleChurn(workspace.admin, cycleId);
    expect(churn.source).toBe('snapshot');
    expect(churn.added).toBe(3);
    expect(churn.removed).toBe(2);
  });

  it('falls back to activity when there are too few snapshots', async () => {
    const churn = await cycleChurn(workspace.admin, cycleId);
    expect(churn.source).toBe('activity');
    expect(churn.added).toBe(0);
    expect(churn.removed).toBe(0);
  });
});

describe('cycleFlowMetrics', () => {
  it('computes cycle time, lead time and throughput with percentiles', async () => {
    await insertIssue(workspace, {
      number: 1,
      state: 'Done',
      cycleId,
      createdAt: utc('2026-01-01T00:00:00Z'),
      startedAt: utc('2026-01-02T00:00:00Z'),
      completedAt: utc('2026-01-04T00:00:00Z'),
    });
    await insertIssue(workspace, {
      number: 2,
      state: 'Done',
      cycleId,
      createdAt: utc('2026-01-01T00:00:00Z'),
      startedAt: utc('2026-01-02T00:00:00Z'),
      completedAt: utc('2026-01-03T00:00:00Z'),
    });
    await insertIssue(workspace, {
      number: 3,
      state: 'Done',
      cycleId,
      createdAt: utc('2026-01-01T00:00:00Z'),
      startedAt: utc('2026-01-03T00:00:00Z'),
      completedAt: utc('2026-01-06T00:00:00Z'),
    });

    const flow = await cycleFlowMetrics(workspace.admin, cycleId);
    expect(flow.throughput).toBe(3);
    expect(flow.cycleTime.p50).toBeCloseTo(2, 5);
    expect(flow.cycleTime.max).toBeCloseTo(3, 5);
    expect(flow.leadTime.p50).toBeCloseTo(3, 5);
    expect(flow.leadTime.max).toBeCloseTo(5, 5);
  });
});

describe('teamVelocity', () => {
  it('reports planned and completed work per cycle', async () => {
    await insertIssue(workspace, { number: 1, state: 'Done', cycleId, createdAt: START });
    await insertIssue(workspace, { number: 2, state: 'Done', cycleId, createdAt: START });
    await insertIssue(workspace, { number: 3, state: 'Todo', cycleId, createdAt: START });

    const velocity = await teamVelocity(workspace.admin, workspace.teamId);
    const point = velocity.find((entry) => entry.cycleId === cycleId);
    expect(point?.planned).toBe(3);
    expect(point?.completed).toBe(2);
  });
});
