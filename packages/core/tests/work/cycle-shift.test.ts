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
  shiftFollowingCycles,
  updateCycle,
} from '../../src/work/cycle-service.ts';

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
