import { describe, expect, it } from 'bun:test';
import { showsEmptyGroups } from '@orbit/shared/filters';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { canDragBoard, columnsReadyFor, planDrop } from '@/features/issues/board.tsx';
import { scrollStep } from '@/features/issues/use-board-autoscroll.ts';
import type { Issue } from '@/lib/query/schemas.ts';

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    organizationId: 'org',
    teamId: 'team_1',
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId: 'todo',
    priority: 0,
    creatorId: 'user',
    assigneeId: null,
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: 1024,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    stateEnteredAt: '',
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  } as Issue;
}

function group(id: string, issues: readonly Issue[]): IssueGroup {
  return {
    id,
    title: id,
    color: null,
    category: null,
    issues,
    subGroups: [],
    total: issues.length,
  };
}

describe('dropping a card when the board is not sorted by hand', () => {
  const todo = issue('a');
  const done = issue('b', { stateId: 'done' });
  const groups = [group('todo', [todo]), group('done', [done])];

  it('still moves the card to the column it was dropped on', () => {
    const move = planDrop(groups, [todo, done], 'a', 'done', 'state', undefined, false);

    expect(move?.stateId).toBe('done');
    expect(move?.beforeId).toBeNull();
    expect(move?.afterId).toBeNull();
  });

  it('does nothing when the card is dropped back on the column it came from', () => {
    expect(planDrop(groups, [todo, done], 'a', 'todo', 'state', undefined, false)).toBeNull();
  });

  it('still places the card between its neighbours when the sort is by hand', () => {
    const first = issue('first', { stateId: 'done', sortOrder: 1024 });
    const second = issue('second', { stateId: 'done', sortOrder: 2048 });
    const mover = issue('mover');
    const columns = [group('todo', [mover]), group('done', [first, second])];

    const move = planDrop(columns, [mover, first, second], 'mover', 'second', 'state', undefined);

    expect(move?.stateId).toBe('done');
    expect(move?.beforeId).toBe('first');
    expect(move?.afterId).toBe('second');
  });
});

describe('which columns a board shows', () => {
  it('shows every column on a board unless somebody said otherwise', () => {
    expect(showsEmptyGroups(null, 'board')).toBe(true);
    expect(showsEmptyGroups(false, 'board')).toBe(false);
    expect(showsEmptyGroups(true, 'board')).toBe(true);
  });

  it('leaves a list alone, where empty groups are only noise', () => {
    expect(showsEmptyGroups(null, 'list')).toBe(false);
  });
});

describe('auto scrolling while a card is in hand', () => {
  it('stays still while the pointer is away from the edge', () => {
    expect(scrollStep(400)).toBe(0);
  });

  it('scrolls faster the closer the pointer gets to the edge', () => {
    const far = scrollStep(60);
    const near = scrollStep(10);

    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far);
  });

  it('never scrolls past its own step limit', () => {
    expect(scrollStep(0, 72, 18)).toBe(18);
  });
});

describe('what a board asks for on first paint', () => {
  it('holds the column requests back until the one board request has answered', () => {
    expect(columnsReadyFor(undefined, true)).toBe(true);
    expect(columnsReadyFor({}, true)).toBe(false);
    expect(columnsReadyFor({}, false)).toBe(true);
  });
});

describe('who may drag a card', () => {
  it('offers drag to a member who may update issues', () => {
    expect(canDragBoard('member', 'state')).toBe(true);
  });

  it('never offers drag to a guest, who cannot update an issue', () => {
    expect(canDragBoard('guest', 'state')).toBe(false);
  });

  it('never offers drag for a grouping that cannot be regrouped', () => {
    expect(canDragBoard('admin', 'label')).toBe(false);
  });
});
