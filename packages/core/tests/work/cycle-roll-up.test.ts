import { beforeEach, describe, expect, it } from 'bun:test';
import { createTeam } from '../../src/org/team-service.ts';
import {
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { listSprintRollUp } from '../../src/work/cycle-roll-up.ts';
import { listCycles } from '../../src/work/cycle-service.ts';
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

describe('listSprintRollUp', () => {
  it('counts committed work and ignores triage and backlog', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Todo', 3);
    await issueIn(cycle.id, 'Done', 5);
    await issueIn(cycle.id, 'Backlog', 8);
    await issueIn(cycle.id, 'Triage', 13);

    const [row] = await listSprintRollUp(workspace.admin, [workspace.teamId]);

    expect(row?.committedIssues).toBe(2);
    expect(row?.completedIssues).toBe(1);
    expect(row?.committedPoints).toBe(8);
    expect(row?.completedPoints).toBe(5);
  });

  it('leaves canceled work out of the committed total', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Todo', 3);
    await issueIn(cycle.id, 'Canceled', 21);

    const [row] = await listSprintRollUp(workspace.admin, [workspace.teamId]);

    expect(row?.committedIssues).toBe(1);
    expect(row?.committedPoints).toBe(3);
  });

  it('counts an issue carrying no estimate without inventing points', async () => {
    const cycle = await runningCycle();
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'No estimate',
    });
    await updateIssue(workspace.admin, issue.id, {
      cycleId: cycle.id,
      stateId: stateNamed(workspace, 'Todo').id,
    });

    const [row] = await listSprintRollUp(workspace.admin, [workspace.teamId]);

    expect(row?.committedIssues).toBe(1);
    expect(row?.committedPoints).toBe(0);
  });

  it('returns a running sprint that holds no issues', async () => {
    const [row] = await listSprintRollUp(workspace.admin, [workspace.teamId]);

    expect(row?.committedIssues).toBe(0);
    expect(row?.committedPoints).toBe(0);
  });

  it('omits a team the principal cannot see', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DES' });
    const stranger = { ...workspace.admin, role: 'member' as const, teamIds: [other.team.id] };

    const rows = await listSprintRollUp(stranger, [workspace.teamId, other.team.id]);

    expect(rows.map((row) => row.teamId)).not.toContain(workspace.teamId);
    expect(rows.map((row) => row.teamId)).toContain(other.team.id);
  });

  it('returns nothing when no team is visible', async () => {
    const stranger = { ...workspace.admin, role: 'member' as const, teamIds: [] };

    expect(await listSprintRollUp(stranger, [workspace.teamId])).toEqual([]);
  });
});
