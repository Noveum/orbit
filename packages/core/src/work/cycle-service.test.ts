import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import { createTeam } from '../org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../test-support.ts';
import {
  activeCycle,
  completeCycle,
  createCycle,
  cycleProgress,
  getCycle,
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

describe('cycle window invariant', () => {
  it('refuses a cycle that overlaps another cycle on the team', async () => {
    const bootstrap = await firstCycle();
    await expect(
      createCycle(workspace.admin, {
        teamId: workspace.teamId,
        startsAt: new Date(bootstrap.endsAt.getTime() - 86_400_000),
        endsAt: new Date(bootstrap.endsAt.getTime() + 86_400_000),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('accepts a cycle that starts exactly when the previous one ends', async () => {
    const bootstrap = await firstCycle();
    const { cycle } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: bootstrap.endsAt,
      endsAt: new Date(bootstrap.endsAt.getTime() + 14 * 86_400_000),
    });
    expect(cycle.number).toBe(2);
  });

  it('scopes the overlap rule to one team', async () => {
    const other = await createTeam(workspace.admin, { name: 'Platform', key: 'PLAT' });
    const window = { startsAt: daysFromNow(20), endsAt: daysFromNow(34) };
    await createCycle(workspace.admin, { teamId: workspace.teamId, ...window });
    const { cycle } = await createCycle(workspace.admin, { teamId: other.team.id, ...window });
    expect(cycle.teamId).toBe(other.team.id);
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

  it('refuses an end date that lands before the stored start date', async () => {
    const cycle = await firstCycle();
    await expect(
      updateCycle(workspace.admin, cycle.id, {
        endsAt: new Date(cycle.startsAt.getTime() - 86_400_000),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses a start date that lands after the stored end date', async () => {
    const cycle = await firstCycle();
    await expect(
      updateCycle(workspace.admin, cycle.id, {
        startsAt: new Date(cycle.endsAt.getTime() + 86_400_000),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses dates that overlap a neighbouring cycle', async () => {
    const bootstrap = await firstCycle();
    const { cycle: next } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: bootstrap.endsAt,
      endsAt: new Date(bootstrap.endsAt.getTime() + 14 * 86_400_000),
    });

    await expect(
      updateCycle(workspace.admin, next.id, {
        startsAt: new Date(bootstrap.endsAt.getTime() - 86_400_000),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('lets a cycle keep its own window while shifting', async () => {
    const cycle = await firstCycle();
    const { cycle: shifted } = await updateCycle(workspace.admin, cycle.id, {
      endsAt: new Date(cycle.endsAt.getTime() + 86_400_000),
    });
    expect(shifted.endsAt.getTime()).toBe(cycle.endsAt.getTime() + 86_400_000);
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

describe('cycle reads are team scoped', () => {
  it('refuses a team the reader is not on and a team in another workspace', async () => {
    const { team } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const guest = await addMember(workspace, 'guest', { teamIds: [workspace.teamId] });
    const vega = await createWorkspace('Vega');

    await expect(listCycles(guest.principal, team.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listCycles(workspace.admin, vega.teamId)).rejects.toMatchObject({
      code: 'not_found',
    });

    const [foreign] = await listCycles(vega.admin, vega.teamId);
    if (foreign === undefined) throw new Error('missing seeded cycle');
    await expect(getCycle(workspace.admin, foreign.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
