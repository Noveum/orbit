import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import { createWorkspace, resetDatabase, stateNamed, type Workspace } from '../test-support.ts';
import {
  activeCycle,
  completeCycle,
  createCycle,
  cycleProgress,
  listCycles,
  upcomingCycles,
  updateCycle,
} from './cycle-service.ts';
import { createIssue, updateIssue } from './issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function firstCycle() {
  const [cycle] = await listCycles(workspace.admin, workspace.teamId);
  if (cycle === undefined) throw new Error('missing bootstrap cycle');
  return cycle;
}

describe('createCycle', () => {
  it('numbers cycles in sequence and names them', async () => {
    const { cycle, actions } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: daysFromNow(20),
      endsAt: daysFromNow(34),
    });
    expect(cycle.number).toBe(2);
    expect(cycle.name).toBe('Cycle 2');
    expect(actions[0]?.scopes).toContain(scopes.team(workspace.teamId));
  });

  it('refuses a cycle that ends before it starts', async () => {
    await expect(
      createCycle(workspace.admin, {
        teamId: workspace.teamId,
        startsAt: daysFromNow(10),
        endsAt: daysFromNow(2),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('activeCycle and upcomingCycles', () => {
  it('finds the running cycle and the future ones', async () => {
    const bootstrap = await firstCycle();
    const active = await activeCycle(workspace.admin, workspace.teamId);
    expect(active?.id).toBe(bootstrap.id);

    await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: daysFromNow(20),
      endsAt: daysFromNow(34),
    });
    const upcoming = await upcomingCycles(workspace.admin, workspace.teamId);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.number).toBe(2);
  });
});

describe('updateCycle', () => {
  it('renames without clearing the dates', async () => {
    const cycle = await firstCycle();
    const { cycle: renamed } = await updateCycle(workspace.admin, cycle.id, { name: 'Sprint one' });
    expect(renamed.name).toBe('Sprint one');
    expect(renamed.startsAt.getTime()).toBe(cycle.startsAt.getTime());
    expect(renamed.endsAt.getTime()).toBe(cycle.endsAt.getTime());
  });
});

describe('cycleProgress', () => {
  it('reports scope, started, completed, and a day by day burn up', async () => {
    const cycle = await firstCycle();
    const created = await Promise.all([
      createIssue(workspace.admin, { teamId: workspace.teamId, title: 'A', cycleId: cycle.id }),
      createIssue(workspace.admin, { teamId: workspace.teamId, title: 'B', cycleId: cycle.id }),
      createIssue(workspace.admin, { teamId: workspace.teamId, title: 'C', cycleId: cycle.id }),
    ]);
    const [a, b] = created;
    if (a === undefined || b === undefined) throw new Error('missing issues');

    await updateIssue(workspace.admin, a.issue.id, {
      stateId: stateNamed(workspace, 'In Progress').id,
    });
    await updateIssue(workspace.admin, b.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });

    const progress = await cycleProgress(workspace.admin, cycle.id);
    expect(progress.scope).toBe(3);
    expect(progress.started).toBe(1);
    expect(progress.completed).toBe(1);
    expect(progress.burnUp).toHaveLength(1);
    expect(progress.burnUp[0]?.completed).toBe(1);

    const later = await cycleProgress(workspace.admin, cycle.id, daysFromNow(3));
    expect(later.burnUp).toHaveLength(4);
    expect(later.burnUp.at(-1)?.completed).toBe(1);
  });
});

describe('completeCycle', () => {
  it('rolls unfinished issues into the next cycle and closes the current one', async () => {
    const cycle = await firstCycle();
    const open = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Still open',
      cycleId: cycle.id,
    });
    const done = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Finished',
      cycleId: cycle.id,
    });
    await updateIssue(workspace.admin, done.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });

    const result = await completeCycle(workspace.admin, cycle.id);
    expect(result.cycle.completedAt).not.toBeNull();
    expect(result.nextCycle.number).toBe(2);
    expect(result.rolledOverIssueIds).toEqual([open.issue.id]);
    expect(result.actions.some((action) => action.model === 'issue')).toBe(true);

    const [rolled] = await db.select().from(schema.issue).where(eq(schema.issue.id, open.issue.id));
    expect(rolled?.cycleId).toBe(result.nextCycle.id);

    const [finished] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, done.issue.id));
    expect(finished?.cycleId).toBe(cycle.id);
  });

  it('refuses to complete a cycle twice', async () => {
    const cycle = await firstCycle();
    await completeCycle(workspace.admin, cycle.id);
    await expect(completeCycle(workspace.admin, cycle.id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
