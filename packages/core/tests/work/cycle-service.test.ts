import { beforeEach, describe, expect, it } from 'bun:test';
import { and, asc, db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import { sprintLabel } from '@orbit/shared/utils';
import { sprintOutcomeSchema } from '@orbit/shared/validators';
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
  getCycle,
  getCycleByNumber,
  listCycles,
  pastCycles,
  sprintOutcome,
  sprintOutcomes,
  startCycle,
  upcomingCycles,
  updateCycle,
} from '../../src/work/cycle-service.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';
import { raceAcrossCycleLock } from '../support/interleave.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function firstCycle() {
  const [cycle] = await listCycles(workspace.admin);
  if (cycle === undefined) throw new Error('missing bootstrap cycle');
  return cycle;
}

describe('createCycle', () => {
  it('numbers sprints in sequence and labels them from the number', async () => {
    const { cycle, actions } = await createCycle(workspace.admin, {
      startsAt: daysFromNow(20),
      endsAt: daysFromNow(34),
    });
    expect(cycle.number).toBe(2);
    expect(cycle.name).toBe('');
    expect(sprintLabel(cycle)).toBe('Sprint 2');
    expect(actions[0]?.scopes).toContain(scopes.organization(workspace.organizationId));
  });

  it('keeps a name someone chose', async () => {
    const { cycle } = await createCycle(workspace.admin, {
      name: 'Hardening',
      startsAt: daysFromNow(20),
      endsAt: daysFromNow(34),
    });
    expect(cycle.name).toBe('Hardening');
    expect(sprintLabel(cycle)).toBe('Hardening');
  });

  it('refuses a cycle that ends before it starts', async () => {
    await expect(
      createCycle(workspace.admin, {
        startsAt: daysFromNow(10),
        endsAt: daysFromNow(2),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('activeCycle and upcomingCycles', () => {
  it('finds the running cycle and the future ones', async () => {
    const bootstrap = await firstCycle();
    const active = await activeCycle(workspace.admin);
    expect(active?.id).toBe(bootstrap.id);

    await createCycle(workspace.admin, {
      startsAt: daysFromNow(20),
      endsAt: daysFromNow(34),
    });
    const upcoming = await upcomingCycles(workspace.admin);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.number).toBe(2);
  });
});

describe('cycle window invariant', () => {
  it('refuses a cycle that overlaps another cycle on the team', async () => {
    const bootstrap = await firstCycle();
    await expect(
      createCycle(workspace.admin, {
        startsAt: new Date(bootstrap.endsAt.getTime() - 86_400_000),
        endsAt: new Date(bootstrap.endsAt.getTime() + 86_400_000),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('accepts a cycle that starts exactly when the previous one ends', async () => {
    const bootstrap = await firstCycle();
    const { cycle } = await createCycle(workspace.admin, {
      startsAt: bootstrap.endsAt,
      endsAt: new Date(bootstrap.endsAt.getTime() + 14 * 86_400_000),
    });
    expect(cycle.number).toBe(2);
  });

  it('applies the overlap rule across the whole workspace', async () => {
    await createTeam(workspace.admin, { name: 'Platform', key: 'PLAT' });
    const window = { startsAt: daysFromNow(20), endsAt: daysFromNow(34) };
    await createCycle(workspace.admin, { ...window });
    await expect(createCycle(workspace.admin, { ...window })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('lets a finished sprint hand its calendar back', async () => {
    const bootstrap = await firstCycle();
    await completeCycle(workspace.admin, bootstrap.id);

    const { cycle } = await createCycle(workspace.admin, {
      name: 'Second attempt',
      startsAt: bootstrap.startsAt,
      endsAt: bootstrap.endsAt,
    });

    expect(cycle.id).not.toBe(bootstrap.id);
    expect(cycle.startsAt.getTime()).toBe(bootstrap.startsAt.getTime());
  });

  it('derives a two week window when no end date is given', async () => {
    const startsAt = daysFromNow(30);
    const { cycle } = await createCycle(workspace.admin, {
      startsAt,
    });
    expect(cycle.endsAt.getTime()).toBe(startsAt.getTime() + 14 * 86_400_000);
  });

  it('appends a sprint after the last one when no dates are given at all', async () => {
    const bootstrap = await firstCycle();
    const { cycle } = await createCycle(workspace.admin, {});

    expect(cycle.startsAt.getTime()).toBe(bootstrap.endsAt.getTime());
    expect(cycle.endsAt.getTime()).toBe(bootstrap.endsAt.getTime() + 14 * 86_400_000);

    const { cycle: third } = await createCycle(workspace.admin, {});
    expect(third.startsAt.getTime()).toBe(cycle.endsAt.getTime());
  });

  it('starts an appended sprint today when nothing is left in the future', async () => {
    const now = new Date('2038-03-09T11:00:00.000Z');
    const { cycle } = await createCycle(workspace.admin, { name: 'Way ahead' }, now);
    expect(cycle.startsAt.toISOString()).toBe('2038-03-09T00:00:00.000Z');
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

describe('startCycle', () => {
  async function plannedSprint() {
    const { cycle } = await createCycle(workspace.admin, {
      name: 'Planned',
      startsAt: daysFromNow(30),
      endsAt: daysFromNow(44),
    });
    return cycle;
  }

  it('pulls a planned sprint to the server clock so it becomes the running one', async () => {
    const planned = await plannedSprint();
    await completeCycle(workspace.admin, (await firstCycle()).id);
    const at = daysFromNow(20);

    const { cycle, actions } = await startCycle(workspace.admin, planned.id, at);

    expect(cycle.startsAt.getTime()).toBe(at.getTime());
    expect(cycle.endsAt.getTime()).toBe(planned.endsAt.getTime());
    expect(actions[0]?.scopes).toEqual([scopes.organization(workspace.organizationId)]);

    const running = await activeCycle(workspace.admin, at);
    expect(running?.id).toBe(planned.id);
  });

  it('refuses to start a second sprint while one is still running', async () => {
    const planned = await plannedSprint();
    const running = await firstCycle();

    await expect(startCycle(workspace.admin, planned.id)).rejects.toMatchObject({
      code: 'conflict',
    });

    const untouched = await getCycle(workspace.admin, planned.id);
    expect(untouched.startsAt.getTime()).toBe(planned.startsAt.getTime());
    expect((await activeCycle(workspace.admin))?.id).toBe(running.id);
  });

  it('refuses a sprint that is already under way', async () => {
    const running = await firstCycle();
    await expect(startCycle(workspace.admin, running.id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('refuses a closed sprint even when its start date is still ahead', async () => {
    const first = await completeCycle(workspace.admin, (await firstCycle()).id);
    const successor = first.nextCycle;
    expect(successor.startsAt.getTime()).toBeGreaterThan(Date.now());
    await completeCycle(workspace.admin, successor.id);

    await expect(startCycle(workspace.admin, successor.id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('refuses to swallow a sprint already scheduled in between', async () => {
    const later = await plannedSprint();
    await completeCycle(workspace.admin, (await firstCycle()).id);
    await createCycle(workspace.admin, {
      name: 'In between',
      startsAt: daysFromNow(16),
      endsAt: daysFromNow(20),
    });

    await expect(startCycle(workspace.admin, later.id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('refuses a role that cannot manage sprints', async () => {
    const planned = await plannedSprint();
    await completeCycle(workspace.admin, (await firstCycle()).id);

    const contributor = await addMember(workspace, 'contributor');
    await expect(startCycle(contributor.principal, planned.id)).rejects.toMatchObject({
      code: 'forbidden',
    });

    const untouched = await getCycle(workspace.admin, planned.id);
    expect(untouched.startsAt.getTime()).toBe(planned.startsAt.getTime());
  });

  it('refuses a sprint in another workspace', async () => {
    const planned = await plannedSprint();
    const vega = await createWorkspace('Vega');
    await expect(startCycle(vega.admin, planned.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  describe('when another transaction commits while it waits for the team lock', () => {
    async function readyToStart() {
      const planned = await plannedSprint();
      await completeCycle(workspace.admin, (await firstCycle()).id);
      return planned;
    }

    function reasonOf(outcome: PromiseSettledResult<unknown>): unknown {
      return outcome.status === 'rejected' ? outcome.reason : undefined;
    }

    it('leaves the history of a sprint closed behind its back alone', async () => {
      const planned = await readyToStart();
      const closedAt = daysFromNow(1);

      const outcome = await raceAcrossCycleLock({
        organizationId: workspace.organizationId,
        race: () => startCycle(workspace.admin, planned.id, daysFromNow(20)),
        interlope: async (client) => {
          await client`update cycle set completed_at = ${closedAt} where id = ${planned.id}`;
        },
      });

      expect(outcome.status).toBe('rejected');
      expect(reasonOf(outcome)).toMatchObject({ code: 'conflict' });

      const after = await getCycle(workspace.admin, planned.id);
      expect(after.completedAt?.getTime()).toBe(closedAt.getTime());
      expect(after.startsAt.getTime()).toBe(planned.startsAt.getTime());
    });

    it('checks the dates it finds after the lock, not the ones it read before', async () => {
      const planned = await readyToStart();
      const movedStart = daysFromNow(16);
      const movedEnd = daysFromNow(18);

      const outcome = await raceAcrossCycleLock({
        organizationId: workspace.organizationId,
        race: () => startCycle(workspace.admin, planned.id, daysFromNow(20)),
        interlope: async (client) => {
          await client`
            update cycle set starts_at = ${movedStart}, ends_at = ${movedEnd}
            where id = ${planned.id}
          `;
        },
      });

      expect(outcome.status).toBe('rejected');
      expect(reasonOf(outcome)).toMatchObject({ code: 'conflict' });

      const after = await getCycle(workspace.admin, planned.id);
      expect(after.startsAt.getTime()).toBe(movedStart.getTime());
      expect(after.endsAt.getTime()).toBe(movedEnd.getTime());
    });
  });
});

describe('cycleProgress', () => {
  it('reports scope, started, completed, and a day by day burn up', async () => {
    const cycle = await firstCycle();
    const created = await Promise.all([
      createIssue(workspace.admin, {
        stateId: stateNamed(workspace, 'Todo').id,
        teamId: workspace.teamId,
        title: 'A',
        cycleId: cycle.id,
      }),
      createIssue(workspace.admin, {
        stateId: stateNamed(workspace, 'Todo').id,
        teamId: workspace.teamId,
        title: 'B',
        cycleId: cycle.id,
      }),
      createIssue(workspace.admin, {
        stateId: stateNamed(workspace, 'Todo').id,
        teamId: workspace.teamId,
        title: 'C',
        cycleId: cycle.id,
      }),
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

async function backdateCycleMoves(issueId: string, times: readonly Date[]): Promise<void> {
  const rows = await db
    .select({ id: schema.issueActivity.id })
    .from(schema.issueActivity)
    .where(
      and(eq(schema.issueActivity.issueId, issueId), eq(schema.issueActivity.field, 'cycleId')),
    )
    .orderBy(asc(schema.issueActivity.createdAt), asc(schema.issueActivity.id));
  for (const [index, row] of rows.entries()) {
    const at = times[index];
    if (at === undefined) continue;
    await db
      .update(schema.issueActivity)
      .set({ createdAt: at })
      .where(eq(schema.issueActivity.id, row.id));
  }
}

function intoSprint(cycle: { startsAt: Date }, days: number, hours = 0): Date {
  return new Date(cycle.startsAt.getTime() + days * 86_400_000 + hours * 3_600_000);
}

async function fileIssueOn(issueId: string, at: Date): Promise<void> {
  await db.update(schema.issue).set({ createdAt: at }).where(eq(schema.issue.id, issueId));
}

async function stampCancelledAt(issueId: string, at: Date | null): Promise<void> {
  await db.update(schema.issue).set({ canceledAt: at }).where(eq(schema.issue.id, issueId));
}

describe('cycleProgress reconstructs the scope of the sprint', () => {
  it('steps the scope up on the day work was added and not before', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Planned',
      cycleId: cycle.id,
    });
    const late = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Added later',
    });
    await updateIssue(workspace.admin, late.issue.id, { cycleId: cycle.id });
    await backdateCycleMoves(late.issue.id, [intoSprint(cycle, 2, 10)]);

    const progress = await cycleProgress(workspace.admin, cycle.id, intoSprint(cycle, 3));
    expect(progress.burnUp.map((point) => point.scope)).toEqual([1, 1, 2, 2]);
    expect(progress.scope).toBe(2);
    expect(progress.changes.added).toBe(1);
    expect(progress.changes.removed).toBe(0);
  });

  it('steps the scope down on the day work was pulled out', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Planned',
      cycleId: cycle.id,
    });
    const pulled = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Pulled out',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, pulled.issue.id, { cycleId: null });
    await backdateCycleMoves(pulled.issue.id, [intoSprint(cycle, 2, 10)]);

    const progress = await cycleProgress(workspace.admin, cycle.id, intoSprint(cycle, 3));
    expect(progress.burnUp.map((point) => point.scope)).toEqual([2, 2, 1, 1]);
    expect(progress.changes.removed).toBe(1);
    expect(progress.changes.removedPoints).toBe(5);
    expect(progress.changes.added).toBe(0);
  });

  it('steps the scope up on the day an issue was filed straight into the running sprint', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Planned',
      cycleId: cycle.id,
    });
    const filed = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Filed mid sprint',
      cycleId: cycle.id,
      estimate: 5,
    });
    await fileIssueOn(filed.issue.id, intoSprint(cycle, 2, 10));

    const progress = await cycleProgress(workspace.admin, cycle.id, intoSprint(cycle, 3));
    expect(progress.burnUp.map((point) => point.scope)).toEqual([1, 1, 2, 2]);
    expect(progress.burnUp.map((point) => point.scopePoints)).toEqual([0, 0, 5, 5]);
    expect(progress.changes.added).toBe(1);
    expect(progress.changes.addedPoints).toBe(5);
  });

  it('keeps cancelled work in the scope until the day it was cancelled', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Kept',
      cycleId: cycle.id,
      estimate: 3,
    });
    const dropped = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Cancelled mid sprint',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, dropped.issue.id, {
      stateId: stateNamed(workspace, 'Canceled').id,
    });
    await stampCancelledAt(dropped.issue.id, intoSprint(cycle, 2, 10));

    const progress = await cycleProgress(workspace.admin, cycle.id, intoSprint(cycle, 3));
    expect(progress.burnUp.map((point) => point.scope)).toEqual([2, 2, 1, 1]);
    expect(progress.burnUp.map((point) => point.scopePoints)).toEqual([8, 8, 3, 3]);
    expect(progress.canceled).toBe(1);
  });

  it('leaves work cancelled without a recorded time out of the sprint from the first day', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Kept',
      cycleId: cycle.id,
      estimate: 3,
    });
    const dropped = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Cancelled at an unknown time',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, dropped.issue.id, {
      stateId: stateNamed(workspace, 'Canceled').id,
    });
    await stampCancelledAt(dropped.issue.id, null);

    const progress = await cycleProgress(workspace.admin, cycle.id, intoSprint(cycle, 2));
    expect(progress.burnUp.map((point) => point.scope)).toEqual([1, 1, 1]);
    expect(progress.burnUp.map((point) => point.scopePoints)).toEqual([3, 3, 3]);
    expect(progress.canceled).toBe(1);
  });

  it('leaves cancelled work out of the scope and counts it on its own', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Kept',
      cycleId: cycle.id,
      estimate: 3,
    });
    const dropped = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Dropped',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, dropped.issue.id, {
      stateId: stateNamed(workspace, 'Canceled').id,
    });

    const progress = await cycleProgress(workspace.admin, cycle.id);
    expect(progress.scope).toBe(1);
    expect(progress.canceled).toBe(1);
    expect(progress.points.scope).toBe(3);
    expect(progress.burnUp.at(-1)?.scope).toBe(1);
    expect(progress.burnUp.at(-1)?.scopePoints).toBe(3);
  });

  it('adds points up from the estimates and counts a missing estimate as zero', async () => {
    const cycle = await firstCycle();
    const done = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Shipped',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, done.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    const running = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Running',
      cycleId: cycle.id,
      estimate: 3,
    });
    await updateIssue(workspace.admin, running.issue.id, {
      stateId: stateNamed(workspace, 'In Progress').id,
    });
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Unsized',
      cycleId: cycle.id,
    });

    const progress = await cycleProgress(workspace.admin, cycle.id);
    expect(progress.scope).toBe(3);
    expect(progress.estimated).toBe(2);
    expect(progress.points).toEqual({ scope: 8, started: 3, completed: 5 });
    expect(progress.burnUp.at(-1)).toMatchObject({ scopePoints: 8, completedPoints: 5 });
  });

  it('keeps the days an issue sat in the sprint when it is pulled out after the sprint ends', async () => {
    const cycle = await firstCycle();
    const carried = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Carried the whole sprint',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, carried.issue.id, { cycleId: null });
    await backdateCycleMoves(carried.issue.id, [intoSprint(cycle, 19, 9)]);

    const progress = await cycleProgress(workspace.admin, cycle.id, intoSprint(cycle, 21));
    expect(progress.burnUp).toHaveLength(15);
    expect(progress.burnUp.map((point) => point.scope)).toEqual(new Array(15).fill(1));
    expect(progress.burnUp.map((point) => point.scopePoints)).toEqual(new Array(15).fill(5));
    expect(progress.changes.removed).toBe(0);
    expect(progress.changes.removedPoints).toBe(0);
  });

  it('leaves work parked in the sprint after it ended out of every day it ran', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Planned',
      cycleId: cycle.id,
      estimate: 2,
    });
    const late = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Parked here once the sprint was over',
      estimate: 5,
    });
    await updateIssue(workspace.admin, late.issue.id, { cycleId: cycle.id });
    await backdateCycleMoves(late.issue.id, [intoSprint(cycle, 19, 9)]);

    const progress = await cycleProgress(workspace.admin, cycle.id, intoSprint(cycle, 21));
    expect(progress.burnUp.map((point) => point.scope)).toEqual(new Array(15).fill(1));
    expect(progress.burnUp.map((point) => point.scopePoints)).toEqual(new Array(15).fill(2));
    expect(progress.changes.added).toBe(0);
    expect(progress.changes.addedPoints).toBe(0);
  });

  it('reports work pulled out before the sprint ended as removed, and stops counting it that day', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Stayed',
      cycleId: cycle.id,
      estimate: 2,
    });
    const pulled = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Pulled out before the end',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, pulled.issue.id, { cycleId: null });
    await backdateCycleMoves(pulled.issue.id, [intoSprint(cycle, 12, 9)]);

    const progress = await cycleProgress(workspace.admin, cycle.id, intoSprint(cycle, 21));
    expect(progress.burnUp.map((point) => point.scopePoints)).toEqual([
      7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 2, 2, 2,
    ]);
    expect(progress.changes.removed).toBe(1);
    expect(progress.changes.removedPoints).toBe(5);
  });
});

describe('completeCycle', () => {
  it('rolls unfinished issues into the next cycle and closes the current one', async () => {
    const cycle = await firstCycle();
    const open = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Still open',
      cycleId: cycle.id,
    });
    const done = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
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

describe('cycle reads are workspace scoped', () => {
  it('refuses a sprint that belongs to another workspace', async () => {
    const vega = await createWorkspace('Vega');

    const [foreign] = await listCycles(vega.admin);
    if (foreign === undefined) throw new Error('missing seeded cycle');
    await expect(getCycle(workspace.admin, foreign.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('cycle writes need the right role, not the right team', () => {
  it('lets any member of the workspace rename a sprint and refuses a contributor', async () => {
    const { principal: member } = await addMember(workspace, 'member');
    const { principal: contributor } = await addMember(workspace, 'contributor');
    const { cycle } = await createCycle(workspace.admin, {
      startsAt: new Date('2030-01-06T00:00:00.000Z'),
      endsAt: new Date('2030-01-20T00:00:00.000Z'),
    });

    const { cycle: renamed } = await updateCycle(member, cycle.id, { name: 'Hardening' });
    expect(renamed.name).toBe('Hardening');

    await expect(updateCycle(contributor, cycle.id, { name: 'Nope' })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('takes an issue from any team into the workspace sprint', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { cycle } = await createCycle(workspace.admin, {
      startsAt: new Date('2030-01-06T00:00:00.000Z'),
      endsAt: new Date('2030-01-20T00:00:00.000Z'),
    });
    const { issue } = await createIssue(workspace.admin, {
      teamId: other.team.id,
      title: 'From another team',
    });

    const { issue: moved } = await updateIssue(workspace.admin, issue.id, { cycleId: cycle.id });

    expect(moved.cycleId).toBe(cycle.id);
    expect(moved.teamId).toBe(other.team.id);
  });

  it('refuses a sprint that belongs to another workspace', async () => {
    const vega = await createWorkspace('Vega');
    const [theirs] = await listCycles(vega.admin);
    if (theirs === undefined) throw new Error('vega has no sprint');
    const { issue } = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Mine',
    });

    await expect(
      updateIssue(workspace.admin, issue.id, { cycleId: theirs.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('a finished sprint keeps its own history', () => {
  it('records what it shipped, because the rollover empties it of unfinished work', async () => {
    const cycle = await firstCycle();
    const shipped = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Shipped',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, shipped.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    const dropped = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Dropped',
      cycleId: cycle.id,
      estimate: 4,
    });
    await updateIssue(workspace.admin, dropped.issue.id, {
      stateId: stateNamed(workspace, 'Canceled').id,
    });
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
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
    expect(live.scope).toBe(1);
    expect(live.canceled).toBe(1);
    expect(outcome.scope).toBeGreaterThan(live.scope);
  });

  it('lists finished sprints newest first, and leaves the running one out', async () => {
    const cycle = await firstCycle();
    await completeCycle(workspace.admin, cycle.id);

    const past = await pastCycles(workspace.admin);
    expect(past.map((row) => row.id)).toEqual([cycle.id]);
    expect(past[0]?.completedAt).not.toBeNull();
  });

  it('finds a sprint by its number, which is the handle a url can carry', async () => {
    const cycle = await firstCycle();
    const found = await getCycleByNumber(workspace.admin, cycle.number);
    expect(found?.id).toBe(cycle.id);
    expect(await getCycleByNumber(workspace.admin, 9999)).toBeNull();
  });

  it('keeps another workspace out of the history it asks for', async () => {
    const outsider = await createWorkspace('Vega');
    const theirs = await pastCycles(outsider.admin);
    const mine = await pastCycles(workspace.admin);
    const ids = new Set(mine.map((cycle) => cycle.id));
    expect(theirs.some((cycle) => ids.has(cycle.id))).toBe(false);
  });
});

describe('the sprint that follows a completed one', () => {
  it('does not overlap a sprint that already exists later in the calendar', async () => {
    const later = await createCycle(workspace.admin, {
      startsAt: new Date('2033-04-03T00:00:00.000Z'),
      endsAt: new Date('2033-04-17T00:00:00.000Z'),
    });
    const earlier = await createCycle(workspace.admin, {
      startsAt: new Date('2033-03-20T00:00:00.000Z'),
      endsAt: new Date('2033-04-01T00:00:00.000Z'),
    });

    const closed = await completeCycle(workspace.admin, earlier.cycle.id);
    const successor = closed.nextCycle;

    const rows = await listCycles(workspace.admin);
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
      startsAt: new Date('2034-01-02T00:00:00.000Z'),
      endsAt: new Date('2034-01-16T00:00:00.000Z'),
    });
    const planned = await createCycle(workspace.admin, {
      startsAt: new Date('2034-01-16T00:00:00.000Z'),
      endsAt: new Date('2034-01-30T00:00:00.000Z'),
    });

    const closed = await completeCycle(workspace.admin, first.cycle.id);
    expect(closed.nextCycle.id).toBe(planned.cycle.id);
  });

  it('numbers a minted successor above every sprint the team has', async () => {
    const first = await firstCycle();
    await createCycle(workspace.admin, {
      startsAt: new Date('2035-06-05T00:00:00.000Z'),
      endsAt: new Date('2035-06-19T00:00:00.000Z'),
    });
    const closed = await completeCycle(workspace.admin, first.id);
    const all = await listCycles(workspace.admin);
    const numbers = all.map((row) => row.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(closed.nextCycle.number).toBe(Math.max(...numbers));
  });
});

describe('two people closing the same sprint at once', () => {
  it('lets one through, refuses the other, and leaves a single successor', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
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

    const all = await listCycles(workspace.admin);
    const closed = all.filter((row) => row.completedAt !== null);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.id).toBe(cycle.id);

    const recorded = sprintOutcomeSchema.parse(closed[0]?.progressSnapshot);
    expect(recorded.rolledOver).toBe(1);
  });

  it('mints a successor when the only later sprint has already been closed', async () => {
    const later = await createCycle(workspace.admin, {
      startsAt: new Date('2036-02-02T00:00:00.000Z'),
      endsAt: new Date('2036-02-16T00:00:00.000Z'),
    });
    await completeCycle(workspace.admin, later.cycle.id);

    const earlier = await createCycle(workspace.admin, {
      startsAt: new Date('2036-01-05T00:00:00.000Z'),
      endsAt: new Date('2036-01-19T00:00:00.000Z'),
    });
    const closed = await completeCycle(workspace.admin, earlier.cycle.id);

    expect(closed.nextCycle.id).not.toBe(later.cycle.id);
    expect(closed.nextCycle.completedAt).toBeNull();
    expect(closed.nextCycle.number).toBeGreaterThan(later.cycle.number);
  });
});

describe('sprintOutcome', () => {
  it('hands back what was recorded when the sprint was closed', async () => {
    const cycle = await firstCycle();
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Shipped',
      cycleId: cycle.id,
      estimate: 5,
    });
    const closed = await completeCycle(workspace.admin, cycle.id);

    const outcome = await sprintOutcome(workspace.admin, closed.cycle.id);
    expect(outcome?.reconstructed).toBe(false);
    expect(outcome?.scope).toBe(1);
  });

  it('counts a sprint closed before outcomes were recorded, rather than saying nothing', async () => {
    const cycle = await firstCycle();
    const done = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Finished',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, done.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Left over',
      cycleId: cycle.id,
      estimate: 3,
    });
    const closed = await completeCycle(workspace.admin, cycle.id);

    await db
      .update(schema.cycle)
      .set({ progressSnapshot: null })
      .where(eq(schema.cycle.id, closed.cycle.id));

    const outcome = await sprintOutcome(workspace.admin, closed.cycle.id);
    expect(outcome?.reconstructed).toBe(true);
    expect(outcome?.scope).toBe(1);
    expect(outcome?.completed).toBe(1);
    expect(outcome?.points).toEqual({ scope: 5, completed: 5 });
  });

  it('has nothing to say about a sprint still running', async () => {
    const cycle = await firstCycle();
    expect(await sprintOutcome(workspace.admin, cycle.id)).toBeNull();
  });
});

describe('sprintOutcomes', () => {
  it('answers for a page of sprints in one pass, recorded or counted', async () => {
    const first = await firstCycle();
    const one = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'In the first',
      cycleId: first.id,
      estimate: 2,
    });
    await updateIssue(workspace.admin, one.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    const closedFirst = await completeCycle(workspace.admin, first.id);

    const second = await createCycle(workspace.admin, {
      startsAt: daysFromNow(200),
      endsAt: daysFromNow(214),
    });
    const two = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'In the second',
      cycleId: second.cycle.id,
      estimate: 8,
    });
    await updateIssue(workspace.admin, two.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    const closedSecond = await completeCycle(workspace.admin, second.cycle.id);

    await db
      .update(schema.cycle)
      .set({ progressSnapshot: null })
      .where(eq(schema.cycle.id, closedSecond.cycle.id));

    const outcomes = await sprintOutcomes(workspace.admin, [
      await getCycle(workspace.admin, closedFirst.cycle.id),
      await getCycle(workspace.admin, closedSecond.cycle.id),
    ]);

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.reconstructed).toBe(false);
    expect(outcomes[0]?.points.scope).toBe(2);
    expect(outcomes[1]?.reconstructed).toBe(true);
    expect(outcomes[1]?.points.scope).toBe(8);
  });

  it('counts the sprint when the stored snapshot is malformed rather than trusting it', async () => {
    const cycle = await firstCycle();
    const done = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Finished',
      cycleId: cycle.id,
      estimate: 7,
    });
    await updateIssue(workspace.admin, done.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    const closed = await completeCycle(workspace.admin, cycle.id);

    await db
      .update(schema.cycle)
      .set({ progressSnapshot: { scope: 'not a number' } })
      .where(eq(schema.cycle.id, closed.cycle.id));

    const outcome = await sprintOutcome(workspace.admin, closed.cycle.id);
    expect(outcome?.reconstructed).toBe(true);
    expect(outcome?.scope).toBe(1);
    expect(outcome?.points.scope).toBe(7);
  });

  it('counts only what is still in the sprint, since a rollover moved the rest away', async () => {
    const cycle = await firstCycle();
    const done = await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Finished',
      cycleId: cycle.id,
      estimate: 3,
    });
    await updateIssue(workspace.admin, done.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    await createIssue(workspace.admin, {
      stateId: stateNamed(workspace, 'Todo').id,
      teamId: workspace.teamId,
      title: 'Rolled over',
      cycleId: cycle.id,
      estimate: 5,
    });
    const closed = await completeCycle(workspace.admin, cycle.id);
    expect(closed.rolledOverIssueIds).toHaveLength(1);

    await db
      .update(schema.cycle)
      .set({ progressSnapshot: null })
      .where(eq(schema.cycle.id, closed.cycle.id));

    const [outcome] = await sprintOutcomes(workspace.admin, [
      await getCycle(workspace.admin, closed.cycle.id),
    ]);

    expect(outcome?.reconstructed).toBe(true);
    expect(outcome?.scope).toBe(1);
    expect(outcome?.points.scope).toBe(3);
  });
});
