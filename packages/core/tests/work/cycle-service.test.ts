import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import { sprintOutcomeSchema } from '@orbit/shared/validators';
import { cycleBurndown, teamVelocity } from '../../src/analytics/burndown.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import {
  activeCycle,
  completeCycle,
  createCycle,
  cycleProgress,
  deleteCycle,
  getCycle,
  getCycleByNumber,
  listCycles,
  pastCycles,
  upcomingCycles,
  updateCycle,
} from '../../src/work/cycle-service.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';

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
  it('numbers sprints in sequence and names them', async () => {
    const { cycle, actions } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: daysFromNow(20),
      endsAt: daysFromNow(34),
    });
    expect(cycle.number).toBe(2);
    expect(cycle.name).toBe('Sprint 2');
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

describe('cycle writes are team scoped', () => {
  it('refuses a member of another team renaming or deleting a sprint', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { principal: outsider } = await addMember(workspace, 'member', {
      teamIds: [other.team.id],
    });
    const { cycle } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2030-01-06T00:00:00.000Z'),
      endsAt: new Date('2030-01-20T00:00:00.000Z'),
    });

    await expect(updateCycle(outsider, cycle.id, { name: 'Hijacked' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(deleteCycle(outsider, cycle.id)).rejects.toMatchObject({ code: 'forbidden' });

    const still = await getCycle(workspace.admin, cycle.id);
    expect(still.name).not.toBe('Hijacked');
  });

  it('refuses putting an issue into another team sprint', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { cycle: theirs } = await createCycle(workspace.admin, {
      teamId: other.team.id,
      startsAt: new Date('2030-01-06T00:00:00.000Z'),
      endsAt: new Date('2030-01-20T00:00:00.000Z'),
    });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Mine',
    });

    await expect(
      updateIssue(workspace.admin, issue.id, { cycleId: theirs.id }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    await expect(
      createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Also mine',
        cycleId: theirs.id,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('keeps burndown and velocity inside the team', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { principal: outsider } = await addMember(workspace, 'member', {
      teamIds: [other.team.id],
    });
    const { cycle } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2030-01-06T00:00:00.000Z'),
      endsAt: new Date('2030-01-20T00:00:00.000Z'),
    });

    await expect(cycleBurndown(outsider, cycle.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(teamVelocity(outsider, workspace.teamId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('a finished sprint keeps its own history', () => {
  it('records what it shipped, because the rollover empties it of unfinished work', async () => {
    const cycle = await firstCycle();
    const shipped = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Shipped',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, shipped.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    const dropped = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Dropped',
      cycleId: cycle.id,
      estimate: 4,
    });
    await updateIssue(workspace.admin, dropped.issue.id, {
      stateId: stateNamed(workspace, 'Canceled').id,
    });
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Not finished',
      cycleId: cycle.id,
      estimate: 3,
    });

    const closed = await completeCycle(workspace.admin, cycle.id);
    expect(closed.rolledOverIssueIds).toHaveLength(1);

    const outcome = sprintOutcomeSchema.parse(closed.cycle.progressSnapshot);
    expect(outcome.scope).toBe(3);
    expect(outcome.completed).toBe(1);
    expect(outcome.canceled).toBe(1);
    expect(outcome.rolledOver).toBe(1);
    expect(outcome.points).toEqual({ scope: 12, completed: 5 });
    expect(Number.isNaN(Date.parse(outcome.closedAt))).toBe(false);

    const live = await cycleProgress(workspace.admin, cycle.id);
    expect(live.scope).toBe(2);
    expect(outcome.scope).toBeGreaterThan(live.scope);
  });

  it('lists finished sprints newest first, and leaves the running one out', async () => {
    const cycle = await firstCycle();
    await completeCycle(workspace.admin, cycle.id);

    const past = await pastCycles(workspace.admin, workspace.teamId);
    expect(past.map((row) => row.id)).toEqual([cycle.id]);
    expect(past[0]?.completedAt).not.toBeNull();
  });

  it('finds a sprint by its number, which is the handle a url can carry', async () => {
    const cycle = await firstCycle();
    const found = await getCycleByNumber(workspace.admin, workspace.teamId, cycle.number);
    expect(found?.id).toBe(cycle.id);
    expect(await getCycleByNumber(workspace.admin, workspace.teamId, 9999)).toBeNull();
  });

  it('keeps another team out of the history it asks for', async () => {
    const outsider = await createWorkspace('Vega');
    await expect(pastCycles(outsider.admin, workspace.teamId)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('the sprint that follows a completed one', () => {
  it('does not overlap a sprint that already exists later in the calendar', async () => {
    const later = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2033-04-03T00:00:00.000Z'),
      endsAt: new Date('2033-04-17T00:00:00.000Z'),
    });
    const earlier = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2033-03-20T00:00:00.000Z'),
      endsAt: new Date('2033-04-01T00:00:00.000Z'),
    });

    const closed = await completeCycle(workspace.admin, earlier.cycle.id);
    const successor = closed.nextCycle;

    const rows = await listCycles(workspace.admin, workspace.teamId);
    const windows = rows
      .map((row) => ({ from: row.startsAt.getTime(), to: row.endsAt.getTime() }))
      .sort((left, right) => left.from - right.from);
    const clashes = windows.some((window, index) => {
      const next = windows[index + 1];
      return next !== undefined && next.from < window.to;
    });
    expect(clashes).toBe(false);
    expect(successor.id).toBe(later.cycle.id);
  });

  it('adopts the sprint already scheduled next rather than minting another', async () => {
    const first = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2034-01-02T00:00:00.000Z'),
      endsAt: new Date('2034-01-16T00:00:00.000Z'),
    });
    const planned = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2034-01-16T00:00:00.000Z'),
      endsAt: new Date('2034-01-30T00:00:00.000Z'),
    });

    const closed = await completeCycle(workspace.admin, first.cycle.id);
    expect(closed.nextCycle.id).toBe(planned.cycle.id);
  });

  it('numbers a minted successor above every sprint the team has', async () => {
    const first = await firstCycle();
    await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2035-06-05T00:00:00.000Z'),
      endsAt: new Date('2035-06-19T00:00:00.000Z'),
    });
    const closed = await completeCycle(workspace.admin, first.id);
    const all = await listCycles(workspace.admin, workspace.teamId);
    const numbers = all.map((row) => row.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(closed.nextCycle.number).toBe(Math.max(...numbers));
  });
});

describe('two people closing the same sprint at once', () => {
  it('lets one through, refuses the other, and leaves a single successor', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Carried',
      cycleId: cycle.id,
    });

    const outcomes = await Promise.allSettled([
      completeCycle(workspace.admin, cycle.id),
      completeCycle(workspace.admin, cycle.id),
    ]);
    const won = outcomes.filter((entry) => entry.status === 'fulfilled');
    const lost = outcomes.filter((entry) => entry.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    const all = await listCycles(workspace.admin, workspace.teamId);
    const closed = all.filter((row) => row.completedAt !== null);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.id).toBe(cycle.id);

    const recorded = sprintOutcomeSchema.parse(closed[0]?.progressSnapshot);
    expect(recorded.rolledOver).toBe(1);
  });

  it('mints a successor when the only later sprint has already been closed', async () => {
    const later = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2036-02-02T00:00:00.000Z'),
      endsAt: new Date('2036-02-16T00:00:00.000Z'),
    });
    await completeCycle(workspace.admin, later.cycle.id);

    const earlier = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2036-01-05T00:00:00.000Z'),
      endsAt: new Date('2036-01-19T00:00:00.000Z'),
    });
    const closed = await completeCycle(workspace.admin, earlier.cycle.id);

    expect(closed.nextCycle.id).not.toBe(later.cycle.id);
    expect(closed.nextCycle.completedAt).toBeNull();
    expect(closed.nextCycle.number).toBeGreaterThan(later.cycle.number);
  });
});
