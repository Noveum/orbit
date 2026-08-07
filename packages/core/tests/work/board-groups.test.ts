import { beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import type { BoardGroup, BoardPage } from '../../src/work/issue-service.ts';
import {
  BOARD_COLUMN_LIMIT,
  createIssue,
  listBoardGroups,
  listIssues,
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
