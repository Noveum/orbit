import { beforeEach, describe, expect, it } from 'bun:test';
import type { Database } from '@orbit/db';
import { and, count, db, eq, schema } from '@orbit/db';
import { writeCycleSnapshots } from '../../src/analytics/snapshot.ts';
import { insertIssue } from '../../src/analytics/test-fixtures.ts';
import { createTeam } from '../../src/org/team-service.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import { activeCycle, completeCycle, getCycle } from '../../src/work/cycle-service.ts';
import { createIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;
let cycleId: string;
let withinCycle: Date;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const cycle = await activeCycle(workspace.admin);
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

function databaseFailingAfterFinalSnapshot(finalCycleId: string): Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'transaction') return Reflect.get(target, property, receiver);
      const transaction: Database['transaction'] = async (callback) =>
        await target.transaction(async (tx) => {
          const result = await callback(tx);
          const [snapshot] = await tx
            .select({ id: schema.cycleProgressSnapshot.id })
            .from(schema.cycleProgressSnapshot)
            .where(
              and(
                eq(schema.cycleProgressSnapshot.cycleId, finalCycleId),
                eq(schema.cycleProgressSnapshot.isFinal, true),
              ),
            )
            .limit(1);
          if (snapshot === undefined)
            throw new Error('final snapshot was not in the close transaction');
          throw new Error(
            `rollback after final snapshot ${result === undefined ? 'void' : 'result'}`,
          );
        });
      return transaction;
    },
  });
}

describe('writeCycleSnapshots', () => {
  it('bootstraps captured history for every assigned issue including archived work', async () => {
    const archivedId = await insertIssue(workspace, {
      number: 5,
      state: 'Todo',
      cycleId,
      estimate: 2,
    });
    await db
      .update(schema.issue)
      .set({ archivedAt: new Date() })
      .where(eq(schema.issue.id, archivedId));

    await writeCycleSnapshots({ now: withinCycle });
    await writeCycleSnapshots({ now: withinCycle });

    const memberships = await db
      .select()
      .from(schema.cycleIssueMembership)
      .where(eq(schema.cycleIssueMembership.cycleId, cycleId));
    expect(memberships).toHaveLength(4);
    expect(memberships.every((entry) => entry.coverage === 'observed')).toBe(true);
    expect(memberships.some((entry) => entry.issueId === archivedId)).toBe(true);
  });

  it('writes one row per active cycle per day with the correct tallies', async () => {
    const result = await writeCycleSnapshots({ now: withinCycle });
    expect(result.captured).toBeGreaterThanOrEqual(1);
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
    await writeCycleSnapshots({ now: withinCycle });
    await writeCycleSnapshots({ now: withinCycle });
    expect(await snapshotCount()).toBe(1);

    await insertIssue(workspace, { number: 5, state: 'Done', cycleId, estimate: 2 });
    await writeCycleSnapshots({ now: withinCycle });
    expect(await snapshotCount()).toBe(1);

    const [snapshot] = await db
      .select()
      .from(schema.cycleProgressSnapshot)
      .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
    expect(snapshot?.totalIssues).toBe(4);
    expect(snapshot?.completedIssues).toBe(2);
  });

  it('captures the sprint local calendar day idempotently', async () => {
    const first = new Date('2026-08-11T20:30:00.000Z');
    const second = new Date('2026-08-11T21:00:00.000Z');
    await db
      .update(schema.cycle)
      .set({
        timezone: 'Asia/Kolkata',
        startsAt: new Date('2026-08-10T00:00:00.000Z'),
        endsAt: new Date('2026-08-20T00:00:00.000Z'),
      })
      .where(eq(schema.cycle.id, cycleId));

    await writeCycleSnapshots({ now: first });
    await writeCycleSnapshots({ now: second });

    const rows = await db
      .select()
      .from(schema.cycleProgressSnapshot)
      .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capturedOn).toBe('2026-08-12');
    expect(rows[0]?.capturedAt.getTime()).toBe(second.getTime());
    expect(rows[0]?.isFinal).toBe(false);
  });

  it('captures every local day across a daylight-saving transition at six-hour cadence', async () => {
    await db
      .update(schema.cycle)
      .set({
        timezone: 'America/New_York',
        startsAt: new Date('2026-03-01T00:00:00.000Z'),
        endsAt: new Date('2026-03-20T00:00:00.000Z'),
      })
      .where(eq(schema.cycle.id, cycleId));
    const invocations = [
      '2026-03-07T06:00:00.000Z',
      '2026-03-07T12:00:00.000Z',
      '2026-03-07T18:00:00.000Z',
      '2026-03-08T00:00:00.000Z',
      '2026-03-08T06:00:00.000Z',
      '2026-03-08T12:00:00.000Z',
      '2026-03-08T18:00:00.000Z',
      '2026-03-09T00:00:00.000Z',
      '2026-03-09T06:00:00.000Z',
      '2026-03-09T12:00:00.000Z',
      '2026-03-09T18:00:00.000Z',
      '2026-03-10T00:00:00.000Z',
      '2026-03-10T06:00:00.000Z',
    ];

    for (const invocation of invocations) {
      await writeCycleSnapshots({ now: new Date(invocation) });
    }

    const rows = await db
      .select({ capturedOn: schema.cycleProgressSnapshot.capturedOn })
      .from(schema.cycleProgressSnapshot)
      .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
    expect(rows.map((row) => row.capturedOn).sort()).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('isolates legacy invalid timezones and uses UTC for their local date', async () => {
    const invalid = await createWorkspace('InvalidTimezone');
    const invalidCycle = await activeCycle(invalid.admin);
    if (invalidCycle === undefined) throw new Error('expected a second active sprint');
    const capturedAt = new Date('2026-08-11T23:30:00.000Z');
    await db
      .update(schema.cycle)
      .set({
        timezone: 'Mars/Olympus',
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-20T00:00:00.000Z'),
      })
      .where(eq(schema.cycle.id, invalidCycle.id));
    await db
      .update(schema.cycle)
      .set({
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-20T00:00:00.000Z'),
      })
      .where(eq(schema.cycle.id, cycleId));

    await writeCycleSnapshots({ now: capturedAt });

    const rows = await db
      .select({
        cycleId: schema.cycleProgressSnapshot.cycleId,
        capturedOn: schema.cycleProgressSnapshot.capturedOn,
      })
      .from(schema.cycleProgressSnapshot);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.cycleId === invalidCycle.id)?.capturedOn).toBe('2026-08-11');
    expect(rows.some((row) => row.cycleId === cycleId)).toBe(true);
  });

  it('uses UTC for a legacy invalid timezone so sprint close cannot be blocked', async () => {
    await db
      .update(schema.cycle)
      .set({ timezone: 'Mars/Olympus' })
      .where(eq(schema.cycle.id, cycleId));

    await completeCycle(workspace.admin, cycleId, withinCycle);

    const [snapshot] = await db
      .select()
      .from(schema.cycleProgressSnapshot)
      .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
    expect(snapshot?.capturedOn).toBe(withinCycle.toISOString().slice(0, 10));
    expect(snapshot?.isFinal).toBe(true);
    expect((await getCycle(workspace.admin, cycleId)).completedAt).not.toBeNull();
  });

  it('turns the local day row into the final pre-rollover snapshot during close', async () => {
    const closedAt = withinCycle;
    await writeCycleSnapshots({ now: closedAt });

    await completeCycle(workspace.admin, cycleId, closedAt);

    const rows = await db
      .select()
      .from(schema.cycleProgressSnapshot)
      .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capturedAt.getTime()).toBe(closedAt.getTime());
    expect(rows[0]?.isFinal).toBe(true);
    expect(rows[0]?.totalIssues).toBe(3);
    expect(rows[0]?.completedIssues).toBe(1);
    expect(rows[0]?.startedIssues).toBe(1);
    expect(rows[0]?.backlogIssues).toBe(1);
  });

  it('rolls the final snapshot back when a later close statement fails', async () => {
    const failingDatabase = databaseFailingAfterFinalSnapshot(cycleId);

    await expect(
      completeCycle(workspace.admin, cycleId, withinCycle, failingDatabase),
    ).rejects.toThrow('rollback after final snapshot result');

    expect(await snapshotCount()).toBe(0);
    expect((await getCycle(workspace.admin, cycleId)).completedAt).toBeNull();
  });

  it('captures every workspace team and excludes corrupt cross-workspace assignments', async () => {
    const other = await createWorkspace('Vega');
    const foreignIssueId = await insertIssue(other, { number: 1, state: 'Done' });
    const sibling = await createTeam(workspace.admin, { name: 'Platform', key: 'PLAT' });
    const siblingIssue = await createIssue(workspace.admin, {
      teamId: sibling.team.id,
      title: 'Sibling team assignment',
    });
    await db.update(schema.issue).set({ cycleId }).where(eq(schema.issue.id, foreignIssueId));
    await db
      .update(schema.issue)
      .set({ cycleId })
      .where(eq(schema.issue.id, siblingIssue.issue.id));

    await writeCycleSnapshots({ now: withinCycle });

    const [snapshot] = await db
      .select()
      .from(schema.cycleProgressSnapshot)
      .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
    expect(snapshot?.totalIssues).toBe(4);
    const memberships = await db
      .select({ issueId: schema.cycleIssueMembership.issueId })
      .from(schema.cycleIssueMembership)
      .where(eq(schema.cycleIssueMembership.cycleId, cycleId));
    expect(memberships.some((row) => row.issueId === foreignIssueId)).toBe(false);
    expect(memberships.some((row) => row.issueId === siblingIssue.issue.id)).toBe(true);

    await completeCycle(workspace.admin, cycleId, withinCycle);

    const outcomes = await db
      .select({
        issueId: schema.cycleIssueOutcome.issueId,
        teamId: schema.cycleIssueOutcome.teamId,
      })
      .from(schema.cycleIssueOutcome)
      .where(eq(schema.cycleIssueOutcome.cycleId, cycleId));
    expect(outcomes.some((row) => row.issueId === foreignIssueId)).toBe(false);
    expect(outcomes.find((row) => row.issueId === siblingIssue.issue.id)?.teamId).toBe(
      sibling.team.id,
    );
  });
});
