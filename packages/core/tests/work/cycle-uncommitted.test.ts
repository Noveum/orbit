import { beforeEach, describe, expect, it } from 'bun:test';
import {
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { listSprintRollUp } from '../../src/work/cycle-roll-up.ts';
import { cycleProgress, listCycles } from '../../src/work/cycle-service.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function runningCycle() {
  const [cycle] = await listCycles(workspace.admin, workspace.teamId);
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

  it('agrees with the roll up shown on the sprints page', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Todo', 3);
    await issueIn(cycle.id, 'Done', 5);
    await issueIn(cycle.id, 'Triage', 13);
    await issueIn(cycle.id, 'Backlog', 21);

    const progress = await cycleProgress(workspace.admin, cycle.id);
    const [row] = await listSprintRollUp(workspace.admin, [workspace.teamId]);

    expect(row?.committedIssues).toBe(progress.scope);
    expect(row?.committedPoints).toBe(progress.points.scope);
    expect(row?.completedPoints).toBe(progress.points.completed);
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
