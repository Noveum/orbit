import { beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import type { BoardGroup, BoardPage } from '../../src/work/issue-service.ts';
import {
  BOARD_COLUMN_LIMIT,
  BOARD_GROUP_LIMIT,
  createIssue,
  listBoardGroups,
  listIssues,
  moveIssue,
  updateIssue,
} from '../../src/work/issue-service.ts';

let workspace: Workspace;
let teamId: string;
let states: { id: string; name: string }[];

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  teamId = workspace.teamId;
  states = workspace.states.map((state) => ({ id: state.id, name: state.name }));
});

async function newIssue(title: string, stateId?: string) {
  const { issue } = await createIssue(workspace.admin, {
    teamId,
    title,
    ...(stateId === undefined ? {} : { stateId }),
  });
  return issue;
}

function groupOf(page: BoardPage, id: string): BoardGroup | undefined {
  return page.groups.find((group) => group.id === id);
}

describe('listBoardGroups', () => {
  it('returns every column that holds an issue in a single answer', async () => {
    const second = states[1]?.id ?? '';
    await newIssue('First');
    await newIssue('Second', second);

    const page = await listBoardGroups(workspace.admin, { teamId });

    expect(page.groups.length).toBeGreaterThanOrEqual(2);
    expect(page.groups.reduce((sum, group) => sum + group.total, 0)).toBe(2);
  });

  it('counts the whole column even when it only carries the first page', async () => {
    const state = states[0]?.id ?? '';
    for (let index = 0; index < 4; index += 1) await newIssue(`Issue ${index}`, state);

    const page = await listBoardGroups(workspace.admin, { teamId, perGroup: 2 });
    const column = groupOf(page, state);

    expect(column?.issues).toHaveLength(2);
    expect(column?.total).toBe(4);
    expect(column?.nextCursor).not.toBeNull();
  });

  it('leaves no cursor on a column that fits in one page', async () => {
    const state = states[0]?.id ?? '';
    await newIssue('Only one', state);

    const column = groupOf(await listBoardGroups(workspace.admin, { teamId }), state);

    expect(column?.total).toBe(1);
    expect(column?.nextCursor).toBeNull();
  });

  it('hands back the same rows the list endpoint would, in the same order', async () => {
    const state = states[0]?.id ?? '';
    for (let index = 0; index < 5; index += 1) await newIssue(`Issue ${index}`, state);

    const column = groupOf(await listBoardGroups(workspace.admin, { teamId }), state);
    const listed = await listIssues(workspace.admin, { teamId, stateId: state, limit: 50 });

    expect(column?.issues.map((issue) => issue.id)).toEqual(listed.issues.map((issue) => issue.id));
  });

  it('groups by assignee when asked, keeping the unassigned column', async () => {
    const mine = await newIssue('Mine');
    await updateIssue(workspace.admin, mine.id, { assigneeId: workspace.admin.userId });
    await newIssue('Nobody');

    const page = await listBoardGroups(workspace.admin, { teamId, groupBy: 'assignee' });

    expect(groupOf(page, workspace.admin.userId)?.total).toBe(1);
    expect(groupOf(page, 'none')?.total).toBe(1);
  });

  it('caps each column at the page size it was given', async () => {
    const state = states[0]?.id ?? '';
    for (let index = 0; index < 3; index += 1) await newIssue(`Issue ${index}`, state);

    const column = groupOf(await listBoardGroups(workspace.admin, { teamId, perGroup: 1 }), state);

    expect(column?.issues).toHaveLength(1);
    expect(BOARD_COLUMN_LIMIT).toBeGreaterThan(1);
  });

  it('never carries an issue from a team the caller cannot see', async () => {
    const page = await listBoardGroups(workspace.admin, { teamId });

    expect(
      page.groups.every((group) => group.issues.every((issue) => issue.teamId === teamId)),
    ).toBe(true);
  });
});

describe('moving a card without naming neighbours', () => {
  it('changes the group and leaves the manual order alone', async () => {
    const second = states[1]?.id ?? '';
    const issue = await newIssue('Regrouped');
    const before = issue.sortOrder;

    const { issue: moved } = await moveIssue(workspace.admin, issue.id, {
      stateId: second,
      beforeId: null,
      afterId: null,
    });

    expect(moved.stateId).toBe(second);
    expect(moved.sortOrder).toBe(before);
  });

  it('still repositions when a neighbour is named', async () => {
    const first = await newIssue('First');
    const second = await newIssue('Second');

    const { issue: moved } = await moveIssue(workspace.admin, second.id, {
      stateId: first.stateId,
      beforeId: null,
      afterId: first.id,
    });

    expect(moved.sortOrder).toBeLessThan(first.sortOrder);
  });
});

describe('a grouping with more columns than a board can carry', () => {
  it('answers with the largest columns and says it left some out', async () => {
    const many = BOARD_GROUP_LIMIT + 3;
    for (let index = 0; index < many; index += 1) {
      const { issue } = await createIssue(workspace.admin, {
        teamId,
        title: `Estimate ${index}`,
      });
      await updateIssue(workspace.admin, issue.id, { estimate: index + 1 });
    }

    const page = await listBoardGroups(workspace.admin, { teamId, groupBy: 'estimate' });

    expect(page.groups.length).toBe(BOARD_GROUP_LIMIT);
    expect(page.truncated).toBe(true);
    expect(page.groups.every((group) => group.issues.length > 0)).toBe(true);
  });

  it('says nothing was left out when every column fits', async () => {
    await newIssue('Only one');

    const page = await listBoardGroups(workspace.admin, { teamId });

    expect(page.truncated).toBe(false);
  });
});
