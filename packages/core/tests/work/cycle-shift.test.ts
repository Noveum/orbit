import { beforeEach, describe, expect, it } from 'bun:test';
import { scopes } from '@orbit/shared/events';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import {
  completeCycle,
  createCycle,
  getCycle,
  pageOfCycles,
  shiftFollowingCycles,
  updateCycle,
} from '../../src/work/cycle-service.ts';
import { raceAcrossCycleLock } from '../support/interleave.ts';

const DAY = 86_400_000;

let workspace: Workspace;
let base: number;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  base = Date.now();
});

function daysFromNow(days: number): Date {
  return new Date(base + days * DAY);
}

async function scheduled(startDay: number, endDay: number) {
  const { cycle } = await createCycle(workspace.admin, {
    startsAt: daysFromNow(startDay),
    endsAt: daysFromNow(endDay),
  });
  return cycle;
}

describe('shiftFollowingCycles', () => {
  it('moves a later sprint by the same number of days', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);

    const { shifted } = await shiftFollowingCycles(workspace.admin, first.id, {
      after: first.endsAt,
      days: 3,
    });

    expect(shifted.map((row) => row.id)).toEqual([second.id]);
    const moved = await getCycle(workspace.admin, second.id);
    expect(moved.startsAt.getTime()).toBe(second.startsAt.getTime() + 3 * DAY);
    expect(moved.endsAt.getTime()).toBe(second.endsAt.getTime() + 3 * DAY);
  });

  it('makes room before the anchor grows into it', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);

    const { shifted } = await shiftFollowingCycles(workspace.admin, first.id, {
      after: first.endsAt,
      days: 3,
    });
    const extended = await updateCycle(workspace.admin, first.id, { endsAt: daysFromNow(37) });

    expect(shifted.map((row) => row.id)).toEqual([second.id]);
    expect(extended.cycle.endsAt.getTime()).toBeGreaterThan(first.endsAt.getTime());
  });

  it('refuses to extend a sprint over the next one when nothing made room', async () => {
    const first = await scheduled(20, 34);
    await scheduled(34, 48);

    await expect(
      updateCycle(workspace.admin, first.id, { endsAt: daysFromNow(37) }),
    ).rejects.toThrow(/overlap/);
  });

  it('pulls sprints backwards when the anchor shortens', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);

    await shiftFollowingCycles(workspace.admin, first.id, { after: first.endsAt, days: -2 });

    const moved = await getCycle(workspace.admin, second.id);
    expect(moved.startsAt.getTime()).toBe(second.startsAt.getTime() - 2 * DAY);
  });

  it('leaves earlier sprints alone', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);

    const { shifted } = await shiftFollowingCycles(workspace.admin, second.id, {
      after: second.endsAt,
      days: 2,
    });

    expect(shifted.map((row) => row.id)).not.toContain(first.id);
  });

  it('stops at a completed sprint rather than moving past it', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);
    const third = await scheduled(48, 62);
    await completeCycle(workspace.admin, second.id);

    const { shifted } = await shiftFollowingCycles(workspace.admin, first.id, {
      after: first.endsAt,
      days: 5,
    });

    expect(shifted.map((row) => row.id)).not.toContain(second.id);
    expect(shifted.map((row) => row.id)).not.toContain(third.id);
  });

  it('does nothing when asked to move by zero days', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);

    const { shifted, actions } = await shiftFollowingCycles(workspace.admin, first.id, {
      after: first.endsAt,
      days: 0,
    });

    expect(shifted).toEqual([]);
    expect(actions).toEqual([]);
    const untouched = await getCycle(workspace.admin, second.id);
    expect(untouched.startsAt.getTime()).toBe(second.startsAt.getTime());
  });

  it('publishes one action per moved sprint on the workspace scope', async () => {
    const first = await scheduled(20, 34);
    await scheduled(34, 48);

    const { actions } = await shiftFollowingCycles(workspace.admin, first.id, {
      after: first.endsAt,
      days: 1,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.scopes).toContain(scopes.organization(workspace.organizationId));
  });

  it('refuses somebody who cannot manage sprints', async () => {
    const first = await scheduled(20, 34);
    await scheduled(34, 48);
    const { principal } = await addMember(workspace, 'guest');

    await expect(
      shiftFollowingCycles(principal, first.id, { after: first.endsAt, days: 1 }),
    ).rejects.toThrow();
  });
});

describe('an edit that shifts and then fails', () => {
  it('leaves the schedule exactly as it found it', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);
    const third = await scheduled(48, 62);

    await expect(
      updateCycle(workspace.admin, first.id, {
        startsAt: daysFromNow(40),
        endsAt: daysFromNow(37),
        shiftFollowing: true,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const anchor = await getCycle(workspace.admin, first.id);
    const after = await getCycle(workspace.admin, second.id);
    const last = await getCycle(workspace.admin, third.id);

    expect(anchor.endsAt.getTime()).toBe(first.endsAt.getTime());
    expect(after.startsAt.getTime()).toBe(second.startsAt.getTime());
    expect(last.startsAt.getTime()).toBe(third.startsAt.getTime());
  });

  it('moves the anchor and the sprints after it together when it succeeds', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);

    await updateCycle(workspace.admin, first.id, {
      endsAt: daysFromNow(37),
      shiftFollowing: true,
    });

    const anchor = await getCycle(workspace.admin, first.id);
    const after = await getCycle(workspace.admin, second.id);

    expect(anchor.endsAt.getTime()).toBe(daysFromNow(37).getTime());
    expect(after.startsAt.getTime()).toBe(second.startsAt.getTime() + 3 * DAY);
  });
});

describe('a shift that would land on a finished sprint', () => {
  it('refuses rather than parking a sprint on top of one already closed', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);
    const blocker = await scheduled(60, 74);
    await completeCycle(workspace.admin, blocker.id);

    await expect(
      shiftFollowingCycles(workspace.admin, first.id, { after: first.endsAt, days: 30 }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const untouched = await getCycle(workspace.admin, second.id);
    expect(untouched.startsAt.getTime()).toBe(second.startsAt.getTime());
  });
});

describe('two edits shifting the same run at once', () => {
  it('does not move the sprints after it twice', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);

    const outcome = await raceAcrossCycleLock({
      organizationId: workspace.organizationId,
      race: () =>
        updateCycle(workspace.admin, first.id, {
          endsAt: daysFromNow(37),
          shiftFollowing: true,
        }),
      interlope: async (client) => {
        await client`update cycle set ends_at = ends_at + interval '3 days' where id = ${first.id}`;
      },
    });

    expect(outcome.status).toBe('rejected');

    const after = await getCycle(workspace.admin, second.id);
    expect(after.startsAt.getTime()).toBe(second.startsAt.getTime());
    expect(after.endsAt.getTime()).toBe(second.endsAt.getTime());
  });
});

describe('an extension that is not a whole number of days', () => {
  it('moves the sprints after it by exactly that much, leaving no gap', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);
    const extendedBy = 36 * 3_600_000;

    await updateCycle(workspace.admin, first.id, {
      endsAt: new Date(first.endsAt.getTime() + extendedBy),
      shiftFollowing: true,
    });

    const anchor = await getCycle(workspace.admin, first.id);
    const after = await getCycle(workspace.admin, second.id);

    expect(after.startsAt.getTime()).toBe(second.startsAt.getTime() + extendedBy);
    expect(after.startsAt.getTime()).toBe(anchor.endsAt.getTime());
  });

  it('makes room for an extension shorter than a day rather than refusing it', async () => {
    const first = await scheduled(20, 34);
    const second = await scheduled(34, 48);
    const extendedBy = 12 * 3_600_000;

    await updateCycle(workspace.admin, first.id, {
      endsAt: new Date(first.endsAt.getTime() + extendedBy),
      shiftFollowing: true,
    });

    const after = await getCycle(workspace.admin, second.id);
    expect(after.startsAt.getTime()).toBe(second.startsAt.getTime() + extendedBy);
  });
});

describe('paging through the sprints of a workspace', () => {
  it('hands back the newest first, a page at a time', async () => {
    const seeded = (await pageOfCycles(workspace.admin)).total;
    for (let index = 0; index < 5; index += 1) {
      await scheduled(index * 20 + 40, index * 20 + 54);
    }

    const first = await pageOfCycles(workspace.admin, { page: 1, pageSize: 2 });
    const second = await pageOfCycles(workspace.admin, { page: 2, pageSize: 2 });

    expect(first.total).toBe(seeded + 5);
    expect(first.pageCount).toBe(Math.ceil((seeded + 5) / 2));
    expect(first.cycles).toHaveLength(2);
    expect(first.cycles[0]?.startsAt.getTime()).toBeGreaterThan(
      first.cycles[1]?.startsAt.getTime() ?? 0,
    );
    expect(second.cycles[0]?.startsAt.getTime()).toBeLessThan(
      first.cycles[1]?.startsAt.getTime() ?? 0,
    );
  });

  it('never runs off either end of the range', async () => {
    await scheduled(40, 54);
    const all = await pageOfCycles(workspace.admin);

    const before = await pageOfCycles(workspace.admin, { page: 0 });
    const beyond = await pageOfCycles(workspace.admin, { page: 999 });

    expect(before.page).toBe(1);
    expect(beyond.page).toBe(all.pageCount);
    expect(beyond.cycles.length).toBeGreaterThan(0);
  });

  it('pages a long series without ever dividing by zero', async () => {
    const page = await pageOfCycles(workspace.admin, { pageSize: 1 });

    expect(page.pageCount).toBeGreaterThanOrEqual(1);
    expect(page.page).toBe(1);
  });

  it('shows a workspace only its own sprints', async () => {
    await scheduled(40, 54);
    const other = await createWorkspace('Other');

    const mine = await pageOfCycles(workspace.admin);
    const theirs = await pageOfCycles(other.admin);

    expect(mine.total).toBeGreaterThan(theirs.total);
    const ids = new Set(mine.cycles.map((row) => row.id));
    expect(theirs.cycles.every((row) => !ids.has(row.id))).toBe(true);
  });
});

describe('the paging arguments a url can carry', () => {
  it('falls back rather than letting a NaN reach the query', async () => {
    await scheduled(40, 54);

    const page = await pageOfCycles(workspace.admin, {
      page: Number.NaN,
      pageSize: Number.NaN,
    });

    expect(page.page).toBe(1);
    expect(page.cycles.length).toBeGreaterThan(0);
  });

  it('truncates a fractional page rather than offsetting by part of a row', async () => {
    for (let index = 0; index < 3; index += 1) await scheduled(index * 20 + 40, index * 20 + 54);

    const fractional = await pageOfCycles(workspace.admin, { page: 2.7, pageSize: 2 });
    const whole = await pageOfCycles(workspace.admin, { page: 2, pageSize: 2 });

    expect(fractional.page).toBe(2);
    expect(fractional.cycles.map((row) => row.id)).toEqual(whole.cycles.map((row) => row.id));
  });

  it('caps the page size so one request cannot ask for everything', async () => {
    const page = await pageOfCycles(workspace.admin, { pageSize: 100_000 });

    expect(page.cycles.length).toBeLessThanOrEqual(100);
  });
});
