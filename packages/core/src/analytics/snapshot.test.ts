import { beforeEach, describe, expect, it } from 'bun:test';
import { count, db, eq, schema } from '@orbit/db';
import { createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import { activeCycle } from '../work/cycle-service.ts';
import { writeCycleSnapshots } from './snapshot.ts';
import { insertIssue } from './test-fixtures.ts';

let workspace: Workspace;
let cycleId: string;
let withinCycle: Date;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const cycle = await activeCycle(workspace.admin, workspace.teamId);
  if (cycle === undefined) throw new Error('expected a bootstrap active cycle');
  cycleId = cycle.id;
  withinCycle = new Date(cycle.startsAt.getTime() + 86_400_000);
  await insertIssue(workspace, { number: 1, state: 'Done', cycleId, estimate: 3 });
  await insertIssue(workspace, { number: 2, state: 'In Progress', cycleId, estimate: 5 });
  await insertIssue(workspace, { number: 3, state: 'Backlog', cycleId });
  await insertIssue(workspace, { number: 4, state: 'Todo' });
});

async function snapshotCount(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.cycleProgressSnapshot)
    .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
  return Number(row?.total ?? 0);
}

describe('writeCycleSnapshots', () => {
  it('writes one row per active cycle per day with the correct tallies', async () => {
    const result = await writeCycleSnapshots();
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.actions.some((action) => action.model === 'cycle')).toBe(true);

    const [snapshot] = await db
      .select()
      .from(schema.cycleProgressSnapshot)
      .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
    expect(snapshot?.totalIssues).toBe(3);
    expect(snapshot?.completedIssues).toBe(1);
    expect(snapshot?.startedIssues).toBe(1);
    expect(snapshot?.backlogIssues).toBe(1);
    expect(snapshot?.unstartedIssues).toBe(0);
    expect(snapshot?.totalEstimate).toBe(8);
    expect(snapshot?.completedEstimate).toBe(3);
  });

  it('is idempotent on re-run, staying unique on (cycle_id, captured_on)', async () => {
    await writeCycleSnapshots(withinCycle);
    await writeCycleSnapshots(withinCycle);
    expect(await snapshotCount()).toBe(1);

    await insertIssue(workspace, { number: 5, state: 'Done', cycleId, estimate: 2 });
    await writeCycleSnapshots(withinCycle);
    expect(await snapshotCount()).toBe(1);

    const [snapshot] = await db
      .select()
      .from(schema.cycleProgressSnapshot)
      .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
    expect(snapshot?.totalIssues).toBe(4);
    expect(snapshot?.completedIssues).toBe(2);
  });
});
