import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { ZodError } from 'zod';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { archiveIssue, createIssue, updateIssue } from '../../src/work/issue-service.ts';
import {
  boardSince,
  DEFAULT_BOARD_LOOKBACK_MS,
  MAX_BOARD_LOOKBACK_MS,
  standupBoard,
} from '../../src/work/standup-board.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function assignedIssue(assigneeId: string, title: string, teamId?: string) {
  const { issue } = await createIssue(workspace.admin, {
    teamId: teamId ?? workspace.teamId,
    title,
    assigneeId,
  });
  return issue;
}

async function moveTo(issueId: string, stateName: string) {
  const { issue } = await updateIssue(workspace.admin, issueId, {
    stateId: stateNamed(workspace, stateName).id,
  });
  return issue;
}

async function backdate(issueId: string, at: Date) {
  await db
    .update(schema.issue)
    .set({ completedAt: at, updatedAt: at })
    .where(eq(schema.issue.id, issueId));
}

async function touchedAt(issueId: string, at: Date) {
  await db.update(schema.issue).set({ updatedAt: at }).where(eq(schema.issue.id, issueId));
}

describe('boardSince', () => {
  const now = new Date('2030-06-10T12:00:00.000Z');

  it('defaults to the last twenty four hours', () => {
    expect(boardSince(now, undefined).toISOString()).toBe(
      new Date(now.getTime() - DEFAULT_BOARD_LOOKBACK_MS).toISOString(),
    );
  });

  it('keeps a window that sits inside the allowed range', () => {
    const wanted = new Date('2030-06-09T00:00:00.000Z');
    expect(boardSince(now, wanted.toISOString()).toISOString()).toBe(wanted.toISOString());
  });

  it('clamps a window that starts in the future to now', () => {
    expect(boardSince(now, '2030-06-11T00:00:00.000Z').toISOString()).toBe(now.toISOString());
  });

  it('clamps a window older than fourteen days', () => {
    expect(boardSince(now, '2030-01-01T00:00:00.000Z').toISOString()).toBe(
      new Date(now.getTime() - MAX_BOARD_LOOKBACK_MS).toISOString(),
    );
  });
});

describe('standupBoard', () => {
  it('returns work grouped under the assignees who have it', async () => {
    const { user } = await addMember(workspace, 'member', { name: 'Ren Worker' });
    await assignedIssue(user.id, 'Ship the importer');

    const board = await standupBoard(workspace.admin, {});

    expect(board.issues.map((issue) => issue.title)).toEqual(['Ship the importer']);
    expect(board.issues.every((issue) => issue.assigneeId === user.id)).toBe(true);
    expect(board.workload).toEqual([
      { userId: user.id, open: 1, inProgress: 0, completedSince: 0 },
    ]);
  });

  it('leaves unassigned work off the board', async () => {
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Nobody owns this' });

    const board = await standupBoard(workspace.admin, {});

    expect(board.issues).toEqual([]);
    expect(board.workload).toEqual([]);
  });

  it('includes an issue completed inside the window and drops one completed before it', async () => {
    const { user } = await addMember(workspace, 'member', { name: 'Ren Worker' });
    const fresh = await assignedIssue(user.id, 'Closed this morning');
    const stale = await assignedIssue(user.id, 'Closed last week');
    await moveTo(fresh.id, 'Done');
    await moveTo(stale.id, 'Done');
    await backdate(stale.id, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    const board = await standupBoard(workspace.admin, {});

    expect(board.issues.map((issue) => issue.id)).toEqual([fresh.id]);
    expect(board.workload).toEqual([
      { userId: user.id, open: 0, inProgress: 0, completedSince: 1 },
    ]);
  });

  it('widens the window when an older since is asked for', async () => {
    const { user } = await addMember(workspace, 'member', { name: 'Ren Worker' });
    const stale = await assignedIssue(user.id, 'Closed on Friday');
    await moveTo(stale.id, 'Done');
    await backdate(stale.id, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));

    const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const board = await standupBoard(workspace.admin, { since });

    expect(board.since.toISOString()).toBe(since);
    expect(board.issues.map((issue) => issue.id)).toEqual([stale.id]);
  });

  it('excludes archived issues from the rows and from the counts', async () => {
    const { user } = await addMember(workspace, 'member', { name: 'Ren Worker' });
    const kept = await assignedIssue(user.id, 'Still live');
    const gone = await assignedIssue(user.id, 'Filed away');
    await archiveIssue(workspace.admin, gone.id);

    const board = await standupBoard(workspace.admin, {});

    expect(board.issues.map((issue) => issue.id)).toEqual([kept.id]);
    expect(board.workload).toEqual([
      { userId: user.id, open: 1, inProgress: 0, completedSince: 0 },
    ]);
  });

  it('caps the rows per assignee while the counts stay exact above the cap', async () => {
    const { user } = await addMember(workspace, 'member', { name: 'Ren Worker' });
    for (const title of ['One', 'Two', 'Three', 'Four']) {
      await assignedIssue(user.id, title);
    }

    const board = await standupBoard(workspace.admin, { limitPerPerson: '2' });

    expect(board.issues.length).toBe(2);
    expect(board.workload).toEqual([
      { userId: user.id, open: 4, inProgress: 0, completedSince: 0 },
    ]);
  });

  it('gives each bucket its own budget so fresh backlog never evicts stale work in progress', async () => {
    const { user } = await addMember(workspace, 'member', { name: 'Ren Worker' });
    const stalled = await assignedIssue(user.id, 'Stalled for days');
    await moveTo(stalled.id, 'In Progress');
    await touchedAt(stalled.id, new Date(Date.now() - 4 * 24 * 60 * 60 * 1000));
    for (const title of ['Fresh one', 'Fresh two', 'Fresh three']) {
      await assignedIssue(user.id, title);
    }

    const board = await standupBoard(workspace.admin, { limitPerPerson: 2 });

    expect(board.issues.map((issue) => issue.id)).toContain(stalled.id);
    expect(board.issues.length).toBe(3);
    expect(board.workload).toEqual([
      { userId: user.id, open: 4, inProgress: 1, completedSince: 0 },
    ]);
  });

  it('counts review alongside started as in progress', async () => {
    const { user } = await addMember(workspace, 'member', { name: 'Ren Worker' });
    const started = await assignedIssue(user.id, 'Being built');
    const review = await assignedIssue(user.id, 'Waiting on review');
    await moveTo(started.id, 'In Progress');
    await moveTo(review.id, 'In Review');

    const board = await standupBoard(workspace.admin, {});

    expect(board.workload).toEqual([
      { userId: user.id, open: 2, inProgress: 2, completedSince: 0 },
    ]);
  });

  it('hides the issues of a team the viewer does not belong to, while an admin sees them', async () => {
    const { principal, user } = await addMember(workspace, 'member', { name: 'Ren Worker' });
    const { team } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const mine = await assignedIssue(user.id, 'On my team');
    const theirs = await assignedIssue(workspace.admin.userId, 'On another team', team.id);

    const asMember = await standupBoard(principal, {});
    const asAdmin = await standupBoard(workspace.admin, {});

    expect(asMember.issues.map((issue) => issue.id)).toEqual([mine.id]);
    expect(asMember.workload.map((row) => row.userId)).toEqual([user.id]);
    expect(asAdmin.issues.map((issue) => issue.id).sort()).toEqual([mine.id, theirs.id].sort());
  });

  it('rejects a since that is not an instant', async () => {
    await expect(standupBoard(workspace.admin, { since: 'yesterday' })).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  it('rejects a per person cap outside the allowed range', async () => {
    await expect(standupBoard(workspace.admin, { limitPerPerson: 0 })).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});
