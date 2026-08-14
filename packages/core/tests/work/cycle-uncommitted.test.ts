import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, inArray, schema } from '@orbit/db';
import { sprintOutcomeSchema } from '@orbit/shared/validators';
import {
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import {
  activeCycle,
  completeCycle,
  cycleProgress,
  listCycles,
} from '../../src/work/cycle-service.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function runningCycle() {
  const [cycle] = await listCycles(workspace.admin);
  if (cycle === undefined) throw new Error('missing bootstrap cycle');
  return cycle;
}

async function issueIn(cycleId: string, stateName: string, estimate: number) {
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: `${stateName} ${estimate}`,
    estimate,
  });
  await updateIssue(workspace.admin, issue.id, {
    cycleId,
    stateId: stateNamed(workspace, stateName).id,
  });
  return issue;
}

describe('uncommitted work', () => {
  it('keeps triage and backlog out of scope and points', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Todo', 3);
    await issueIn(cycle.id, 'Done', 5);
    await issueIn(cycle.id, 'Triage', 13);
    await issueIn(cycle.id, 'Backlog', 21);

    const progress = await cycleProgress(workspace.admin, cycle.id);

    expect(progress.scope).toBe(2);
    expect(progress.points.scope).toBe(8);
    expect(progress.points.completed).toBe(5);
  });

  it('reports what it left out rather than hiding it', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Todo', 3);
    await issueIn(cycle.id, 'Triage', 13);
    await issueIn(cycle.id, 'Backlog', 21);

    const progress = await cycleProgress(workspace.admin, cycle.id);

    expect(progress.uncommitted).toEqual({ issues: 2, points: 34 });
  });

  it('counts cancelled work separately from uncommitted work', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Todo', 3);
    await issueIn(cycle.id, 'Canceled', 8);
    await issueIn(cycle.id, 'Backlog', 21);

    const progress = await cycleProgress(workspace.admin, cycle.id);

    expect(progress.canceled).toBe(1);
    expect(progress.uncommitted.issues).toBe(1);
    expect(progress.scope).toBe(1);
  });

  it('leaves uncommitted work out of the burn up as well', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Todo', 3);
    await issueIn(cycle.id, 'Backlog', 21);

    const progress = await cycleProgress(workspace.admin, cycle.id);
    const last = progress.burnUp.at(-1);

    expect(last?.scopePoints).toBe(3);
  });
});

describe('completing a sprint never loses a task', () => {
  it('accounts for every issue it held, rolling over or releasing each one', async () => {
    const cycle = await runningCycle();
    const held = [
      await issueIn(cycle.id, 'Triage', 1),
      await issueIn(cycle.id, 'Backlog', 2),
      await issueIn(cycle.id, 'Todo', 3),
      await issueIn(cycle.id, 'In Progress', 5),
      await issueIn(cycle.id, 'In Review', 8),
      await issueIn(cycle.id, 'Done', 13),
      await issueIn(cycle.id, 'Canceled', 21),
    ];

    const closed = await completeCycle(workspace.admin, cycle.id);

    const after = await db
      .select({ id: schema.issue.id, cycleId: schema.issue.cycleId })
      .from(schema.issue)
      .where(
        inArray(
          schema.issue.id,
          held.map((issue) => issue.id),
        ),
      );

    expect(after).toHaveLength(held.length);
    for (const row of after) {
      const stayed = row.cycleId === cycle.id;
      const rolled = row.cycleId === closed.nextCycle.id;
      const released = row.cycleId === null;
      expect(stayed || rolled || released).toBe(true);
    }
  });

  it('sends unfinished work forward and hands uncommitted work back to the backlog', async () => {
    const cycle = await runningCycle();
    const triage = await issueIn(cycle.id, 'Triage', 1);
    const backlog = await issueIn(cycle.id, 'Backlog', 2);
    const todo = await issueIn(cycle.id, 'Todo', 3);
    const done = await issueIn(cycle.id, 'Done', 5);

    const closed = await completeCycle(workspace.admin, cycle.id);

    expect(closed.rolledOverIssueIds).toEqual([todo.id]);
    expect(closed.releasedIssueIds.toSorted()).toEqual([triage.id, backlog.id].toSorted());

    const [stayed] = await db
      .select({ cycleId: schema.issue.cycleId })
      .from(schema.issue)
      .where(eq(schema.issue.id, done.id));
    expect(stayed?.cycleId).toBe(cycle.id);
  });

  it('freezes only committed scope and points in the sprint summary', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Triage', 13);
    await issueIn(cycle.id, 'Backlog', 21);
    await issueIn(cycle.id, 'Todo', 3);
    await issueIn(cycle.id, 'Done', 5);

    const closed = await completeCycle(workspace.admin, cycle.id);
    const outcome = sprintOutcomeSchema.parse(closed.cycle.progressSnapshot);

    expect(outcome.scope).toBe(2);
    expect(outcome.completed).toBe(1);
    expect(outcome.points).toEqual({ scope: 8, completed: 5 });
  });
});

describe('the running sprint', () => {
  it('ignores a sprint that has been archived', async () => {
    const cycle = await runningCycle();
    await db
      .update(schema.cycle)
      .set({ archivedAt: new Date() })
      .where(eq(schema.cycle.id, cycle.id));

    expect(await activeCycle(workspace.admin)).toBeUndefined();
  });
});

describe('an archived sprint', () => {
  it('stays out of the list the workspace reads', async () => {
    const cycle = await runningCycle();
    await db
      .update(schema.cycle)
      .set({ archivedAt: new Date() })
      .where(eq(schema.cycle.id, cycle.id));

    expect((await listCycles(workspace.admin)).map((row) => row.id)).not.toContain(cycle.id);
  });
});
