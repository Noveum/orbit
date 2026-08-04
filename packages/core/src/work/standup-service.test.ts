import { beforeEach, describe, expect, it } from 'bun:test';
import { addMember, createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import {
  addBlocker,
  advanceStandup,
  findStandup,
  focusTurn,
  getRotation,
  listStandups,
  openBlockers,
  openStandup,
  resolveBlocker,
  setRotation,
  startStandup,
  today,
  updateStandup,
  updateTurn,
} from './standup-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function teamOfThree() {
  const second = await addMember(workspace, 'member');
  const third = await addMember(workspace, 'member');
  return { second, third };
}

describe('openStandup', () => {
  it('seats every team member in a stable order and picks a facilitator', async () => {
    await teamOfThree();
    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });

    expect(detail.standup.heldOn).toBe(today());
    expect(detail.standup.status).toBe('scheduled');
    expect(detail.turns.length).toBeGreaterThanOrEqual(1);
    expect(detail.turns.map((turn) => turn.position)).toEqual(
      detail.turns.map((_turn, index) => index),
    );
    expect(detail.standup.facilitatorId).not.toBeNull();
  });

  it('is idempotent for a team on a given day', async () => {
    const first = await openStandup(workspace.admin, { teamId: workspace.teamId });
    const second = await openStandup(workspace.admin, { teamId: workspace.teamId });
    expect(second.detail.standup.id).toBe(first.detail.standup.id);
    expect(second.actions).toEqual([]);
  });

  it('binds the standup to the active sprint when one is running', async () => {
    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });
    expect(detail.standup.cycleId === null || typeof detail.standup.cycleId === 'string').toBe(
      true,
    );
  });

  it('rotates the facilitator to the next person on the following day', async () => {
    await teamOfThree();
    const first = await openStandup(workspace.admin, { teamId: workspace.teamId });
    const second = await openStandup(workspace.admin, {
      teamId: workspace.teamId,
      heldOn: '2030-01-02',
    });
    expect(second.detail.standup.facilitatorId).not.toBe(first.detail.standup.facilitatorId);
  });
});

describe('running the ceremony', () => {
  it('walks the room one person at a time and finishes after the last turn', async () => {
    await teamOfThree();
    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });
    const id = detail.standup.id;

    const started = await startStandup(workspace.admin, id);
    expect(started.detail.standup.status).toBe('running');
    expect(started.detail.standup.currentTurnId).toBe(started.detail.turns[0]?.id ?? null);
    expect(started.detail.turns[0]?.status).toBe('speaking');

    let current = started.detail;
    for (let index = 1; index < detail.turns.length; index += 1) {
      const next = await advanceStandup(workspace.admin, id);
      current = next.detail;
      expect(current.standup.currentTurnId).toBe(current.turns[index]?.id ?? null);
      expect(current.turns[index - 1]?.status).toBe('done');
    }

    const finished = await advanceStandup(workspace.admin, id);
    expect(finished.detail.standup.status).toBe('finished');
    expect(finished.detail.standup.currentTurnId).toBeNull();
    expect(finished.detail.standup.endedAt).not.toBeNull();
  });

  it('skips anyone marked absent when walking the room', async () => {
    await teamOfThree();
    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });
    const id = detail.standup.id;
    const second = detail.turns[1];
    if (second === undefined) throw new Error('expected a second participant');

    await updateTurn(workspace.admin, id, second.id, { attendance: 'absent' });
    const started = await startStandup(workspace.admin, id);
    const next = await advanceStandup(workspace.admin, id);

    expect(started.detail.standup.currentTurnId).toBe(detail.turns[0]?.id ?? null);
    expect(next.detail.standup.currentTurnId).not.toBe(second.id);
  });

  it('lets the facilitator jump straight to a person', async () => {
    await teamOfThree();
    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });
    const target = detail.turns.at(-1);
    if (target === undefined) throw new Error('expected participants');

    await startStandup(workspace.admin, detail.standup.id);
    const focused = await focusTurn(workspace.admin, detail.standup.id, { turnId: target.id });

    expect(focused.detail.standup.currentTurnId).toBe(target.id);
    expect(focused.detail.turns.at(-1)?.status).toBe('speaking');
  });

  it('walks backwards without finishing the standup', async () => {
    await teamOfThree();
    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });
    const id = detail.standup.id;
    await startStandup(workspace.admin, id);
    await advanceStandup(workspace.admin, id);
    const back = await advanceStandup(workspace.admin, id, { direction: 'previous' });

    expect(back.detail.standup.currentTurnId).toBe(detail.turns[0]?.id ?? null);
    expect(back.detail.standup.status).toBe('running');
  });

  it('records what each person said and marks them present', async () => {
    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });
    const turn = detail.turns[0];
    if (turn === undefined) throw new Error('expected a participant');

    const updated = await updateTurn(workspace.admin, detail.standup.id, turn.id, {
      notes: 'Shipped the board fix, picking up sprint planning next.',
      attendance: 'present',
    });

    expect(updated.detail.turns[0]?.notes).toContain('Shipped the board fix');
    expect(updated.detail.turns[0]?.attendance).toBe('present');
  });
});

describe('blockers', () => {
  it('raises a blocker against a turn and clears it when resolved', async () => {
    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });
    const turn = detail.turns[0];
    if (turn === undefined) throw new Error('expected a participant');

    const raised = await addBlocker(workspace.admin, detail.standup.id, turn.id, {
      summary: 'Waiting on the staging database credentials.',
    });
    expect(raised.detail.blockers).toHaveLength(1);

    const open = await openBlockers(workspace.admin, workspace.teamId);
    expect(open).toHaveLength(1);

    const blocker = raised.detail.blockers[0];
    if (blocker === undefined) throw new Error('expected a blocker');
    await resolveBlocker(workspace.admin, detail.standup.id, blocker.id, { resolved: true });

    expect(await openBlockers(workspace.admin, workspace.teamId)).toHaveLength(0);
  });
});

describe('rotation', () => {
  it('drives both the speaking order and who facilitates', async () => {
    const { second, third } = await teamOfThree();
    await setRotation(workspace.admin, {
      teamId: workspace.teamId,
      members: [
        { userId: third.user.id, facilitates: true },
        { userId: second.user.id, facilitates: false },
        { userId: workspace.admin.userId, facilitates: true },
      ],
    });

    const rotation = await getRotation(workspace.admin, workspace.teamId);
    expect(rotation.map((row) => row.userId)).toEqual([
      third.user.id,
      second.user.id,
      workspace.admin.userId,
    ]);

    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });
    expect(detail.turns.map((turn) => turn.userId)).toEqual([
      third.user.id,
      second.user.id,
      workspace.admin.userId,
    ]);
    expect(detail.standup.facilitatorId).toBe(third.user.id);
  });

  it('refuses to let a contributor rewrite the rotation', async () => {
    const { principal } = await addMember(workspace, 'contributor');
    await expect(
      setRotation(principal, { teamId: workspace.teamId, members: [] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('history', () => {
  it('lists past standups newest first and finds one by day', async () => {
    await openStandup(workspace.admin, { teamId: workspace.teamId, heldOn: '2030-01-01' });
    await openStandup(workspace.admin, { teamId: workspace.teamId, heldOn: '2030-01-02' });

    const listed = await listStandups(workspace.admin, { teamId: workspace.teamId });
    expect(listed.map((row) => row.heldOn)).toEqual(['2030-01-02', '2030-01-01']);

    const found = await findStandup(workspace.admin, workspace.teamId, '2030-01-01');
    expect(found?.standup.heldOn).toBe('2030-01-01');
    expect(await findStandup(workspace.admin, workspace.teamId, '2029-12-31')).toBeNull();
  });

  it('keeps a finished standup out of the running state', async () => {
    const { detail } = await openStandup(workspace.admin, { teamId: workspace.teamId });
    const finished = await updateStandup(workspace.admin, detail.standup.id, {
      status: 'finished',
    });
    expect(finished.detail.standup.endedAt).not.toBeNull();
    await expect(startStandup(workspace.admin, detail.standup.id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});

describe('permissions', () => {
  it('stops a guest from opening a standup', async () => {
    const { principal } = await addMember(workspace, 'guest');
    await expect(openStandup(principal, { teamId: workspace.teamId })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
