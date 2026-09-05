import { describe, expect, it } from 'bun:test';
import { defaultDisplayOptions, showsEmptyGroups } from '@orbit/shared/filters';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import {
  boardFocusRemountMayQueue,
  boardFocusRequestMayRun,
  boardPositionsAreIncomplete,
  canDragBoard,
  columnsReadyFor,
  completedDragResult,
  dragSourceSnapshotFor,
  dragTargetSnapshotFor,
  dropPositionFor,
  focusRemainsBoardOwned,
  moveResultWasSuperseded,
  planDrop,
  registeredBoardPosition,
  sameBoardSource,
  settledDragStatus,
} from '@/features/issues/board.tsx';
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

function group(id: string, issues: readonly Issue[], total = issues.length): IssueGroup {
  return {
    id,
    title: id,
    color: null,
    category: null,
    issues,
    subGroups: [],
    total,
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

describe('reordering a card within its current column', () => {
  const first = issue('first', { sortOrder: 1024 });
  const second = issue('second', { sortOrder: 2048 });
  const third = issue('third', { sortOrder: 3072 });
  const fourth = issue('fourth', { sortOrder: 4096 });
  const rows = [first, second, third, fourth];
  const groups = [group('todo', rows)];

  it('inserts after the card crossed while moving down', () => {
    const move = planDrop(groups, rows, 'second', 'third', 'state');

    expect(move?.beforeId).toBe('third');
    expect(move?.afterId).toBe('fourth');
  });

  it('reports the resulting ordinal after moving down', () => {
    expect(dropPositionFor(groups, 'second', 'third')).toEqual({
      column: 'todo',
      position: 3,
      total: 4,
    });
  });

  it('inserts before the card crossed while moving up', () => {
    const move = planDrop(groups, rows, 'third', 'second', 'state');

    expect(move?.beforeId).toBe('first');
    expect(move?.afterId).toBe('second');
  });

  it('does not present a loaded subset count as the column total', () => {
    expect(dropPositionFor([group('todo', rows, 40)], 'second', 'third')).toEqual({
      column: 'todo',
      position: 3,
    });
  });
});

describe('settling keyboard drag feedback', () => {
  const completed = {
    session: 1,
    identifier: 'ENG-1',
    source: { groupId: 'todo', column: 'Todo', position: 1, total: 2 },
    destination: { groupId: 'todo', column: 'Todo', position: 2, total: 2 },
  };

  it('does not publish an older result over a newer active drag', () => {
    expect(
      settledDragStatus({
        latestSession: 2,
        activeSession: 2,
        completed,
        outcome: 'success',
        settledPosition: { column: 'Todo', position: 2, total: 2 },
      }),
    ).toBeNull();
  });

  it('does not publish an older result after the newer drag ends', () => {
    expect(
      settledDragStatus({
        latestSession: 2,
        activeSession: null,
        completed,
        outcome: 'success',
        settledPosition: { column: 'Todo', position: 2, total: 2 },
      }),
    ).toBeNull();
  });

  it('does not publish a result while its drag is active', () => {
    expect(
      settledDragStatus({
        latestSession: 1,
        activeSession: 1,
        completed,
        outcome: 'success',
        settledPosition: { column: 'Todo', position: 2, total: 2 },
      }),
    ).toBeNull();
  });

  it('announces the authoritative position after the current move succeeds', () => {
    expect(
      settledDragStatus({
        latestSession: 1,
        activeSession: null,
        completed,
        outcome: 'success',
        settledPosition: { column: 'Todo', position: 2, total: 2 },
      }),
    ).toBe('Moved ENG-1 from column Todo, position 1 of 2 to column Todo, position 2 of 2.');
  });

  it('announces the authoritative restored position after the current move fails', () => {
    expect(
      settledDragStatus({
        latestSession: 1,
        activeSession: null,
        completed,
        outcome: 'error',
        settledPosition: { column: 'Todo', position: 1, total: 2 },
      }),
    ).toBe('Failed to move ENG-1. Returned to column Todo, position 1 of 2.');
  });

  it('uses safe column-only feedback when the settled card is filtered out', () => {
    expect(
      settledDragStatus({
        latestSession: 1,
        activeSession: null,
        completed,
        outcome: 'success',
        settledPosition: null,
      }),
    ).toBe('Moved ENG-1 from column Todo, position 1 of 2 to column Todo.');
  });

  it('suppresses a planned endpoint when a newer cache head already won', () => {
    const response = issue('held', { stateId: 'done', syncId: 2 });
    const current = issue('held', { stateId: 'todo', syncId: 3 });

    expect(moveResultWasSuperseded({ kind: 'found', issue: current }, response, 'success')).toBe(
      true,
    );
    expect(moveResultWasSuperseded({ kind: 'ambiguous' }, response, 'success')).toBe(true);
    expect(moveResultWasSuperseded({ kind: 'found', issue: response }, response, 'success')).toBe(
      false,
    );
    expect(
      completedDragResult({
        latestSession: 1,
        activeSession: null,
        completed,
        outcome: 'success',
        settledPosition: { column: 'Todo', position: 2, total: 2 },
        superseded: true,
      }),
    ).toEqual({
      status: 'ENG-1 changed again while the move finished. Showing the latest version.',
      focusGroupId: null,
    });
  });

  it('accepts a successful move that intentionally exits every filtered list', () => {
    const response = issue('held', { stateId: 'done', syncId: 2 });

    expect(moveResultWasSuperseded({ kind: 'missing' }, response, 'success', false)).toBe(false);
    expect(moveResultWasSuperseded({ kind: 'missing' }, response, 'success', true)).toBe(true);
    expect(moveResultWasSuperseded({ kind: 'missing' }, response, 'error')).toBe(true);
  });

  it('announces deletion and returns the outcome focus fallback', () => {
    for (const outcome of ['success', 'error'] as const) {
      expect(
        completedDragResult({
          latestSession: 1,
          activeSession: null,
          completed,
          outcome,
          settledPosition: null,
          superseded: true,
          deleted: true,
        }),
      ).toEqual({
        status: 'ENG-1 was deleted while the move finished.',
        focusGroupId: 'todo',
      });
    }
  });

  it('never derives a complete total from a windowed destination', () => {
    const column = document.createElement('ul');
    const cards = Array.from({ length: 15 }, () => {
      const card = document.createElement('li');
      card.tabIndex = 0;
      column.append(card);
      return card;
    });
    const sentinel = document.createElement('li');
    sentinel.setAttribute('aria-hidden', 'true');
    column.append(sentinel);
    const held = cards[13];
    if (held === undefined) throw new Error('missing held card');

    expect(
      registeredBoardPosition(
        'held',
        { groupId: 'done', column: 'Done', position: 14, total: 15 },
        new Map([['held', held]]),
        new Map([['done', column]]),
      ),
    ).toEqual({ column: 'Done', position: 14 });
  });

  it('does not reclaim focus from another control after settlement', () => {
    const card = document.createElement('li');
    const column = document.createElement('ul');
    const alternateColumn = document.createElement('ul');
    const otherControl = document.createElement('button');

    expect(
      focusRemainsBoardOwned(document.body, document.body, card, column, alternateColumn),
    ).toBe(true);
    expect(focusRemainsBoardOwned(card, document.body, card, column, alternateColumn)).toBe(true);
    expect(focusRemainsBoardOwned(column, document.body, card, column, alternateColumn)).toBe(true);
    expect(
      focusRemainsBoardOwned(alternateColumn, document.body, card, column, alternateColumn),
    ).toBe(true);
    expect(focusRemainsBoardOwned(otherControl, document.body, card, column, alternateColumn)).toBe(
      false,
    );
  });

  it('rechecks focus ownership when queued restoration executes', () => {
    expect(boardFocusRequestMayRun(1, 1, 1, 1, false, true)).toBe(true);
    expect(boardFocusRequestMayRun(1, 1, 1, 1, false, false)).toBe(false);
  });

  it('queues a focused node remount before rechecking dynamic ownership', () => {
    const previous = document.createElement('li');
    const replacement = document.createElement('li');
    const column = document.createElement('ul');
    const otherControl = document.createElement('button');
    previous.tabIndex = 0;
    document.body.append(previous, column, otherControl);
    previous.focus();
    const cards = new Map<string, HTMLLIElement>([['held', previous]]);
    const focusAllowed = () =>
      focusRemainsBoardOwned(document.activeElement, document.body, cards.get('held'), column);
    cards.delete('held');

    expect(focusAllowed()).toBe(false);
    expect(boardFocusRemountMayQueue(previous, document.body, previous, 1, 1, 1, 1, false)).toBe(
      true,
    );

    previous.remove();
    cards.set('held', replacement);
    expect(focusAllowed()).toBe(true);
    otherControl.focus();
    expect(focusAllowed()).toBe(false);
    column.remove();
    otherControl.remove();
  });
});

describe('identifying the authoritative drag source', () => {
  it('distinguishes same-named groups by stable identity', () => {
    expect(
      sameBoardSource(
        { groupId: 'member_1', column: 'Alex', position: 1, total: 2 },
        { groupId: 'member_2', column: 'Alex', position: 1, total: 2 },
      ),
    ).toBe(false);
  });

  it('ignores a total-only change in the same group and position', () => {
    expect(
      sameBoardSource(
        { groupId: 'member_1', column: 'Alex', position: 1, total: 2 },
        { groupId: 'member_1', column: 'Alex', position: 1, total: 3 },
      ),
    ).toBe(true);
  });

  it('fails closed when equal-head mirrors disagree about the source', () => {
    const todo = issue('held', { syncId: 2, stateId: 'todo' });
    const done = issue('held', { syncId: 2, stateId: 'done' });

    expect(
      dragSourceSnapshotFor(
        [group('todo', [todo]), group('done', [done])],
        'held',
        'state',
        undefined,
      ).kind,
    ).toBe('ambiguous');
  });

  it('uses the first identical source mirror when row windows differ', () => {
    const held = issue('held', { syncId: 2 });
    const sibling = issue('sibling', { syncId: 2, sortOrder: 2048 });

    expect(
      dragSourceSnapshotFor(
        [group('todo', [sibling, held]), group('todo', [held, sibling])],
        'held',
        'state',
        undefined,
      ),
    ).toEqual({
      kind: 'found',
      issue: held,
      source: { groupId: 'todo', column: 'todo', position: 2, total: 2 },
    });
  });

  it('ignores transport-only differences in equal-head source mirrors', () => {
    const detailed = issue('held', {
      organizationId: 'org',
      description: 'loaded by the issue list',
      stateEnteredAt: '2026-01-02T00:00:00.000Z',
      syncId: 2,
    });
    const summarized = issue('held', {
      organizationId: '',
      description: '',
      stateEnteredAt: '',
      syncId: 2,
    });

    expect(
      dragSourceSnapshotFor(
        [group('todo', [detailed]), group('todo', [summarized])],
        'held',
        'state',
        undefined,
      ).kind,
    ).toBe('found');
  });

  it('waits when the newest mirror has not reached its matching group', () => {
    const regrouping = issue('held', { syncId: 2, stateId: 'done' });

    expect(
      dragSourceSnapshotFor([group('todo', [regrouping])], 'held', 'state', undefined).kind,
    ).toBe('pending');
  });
});

describe('identifying the authoritative drop target', () => {
  it('uses the first identical target mirror when row windows differ', () => {
    const held = issue('held');
    const first = issue('first', { stateId: 'done', syncId: 2, sortOrder: 1024 });
    const target = issue('target', { stateId: 'done', syncId: 2, sortOrder: 2048 });

    expect(
      dragTargetSnapshotFor(
        [group('done', [first, target]), group('done', [target, first])],
        held,
        'target',
        'state',
        undefined,
        true,
      ),
    ).toEqual({
      kind: 'found',
      target: {
        overId: 'target',
        destination: { groupId: 'done', column: 'done', position: 2, total: 3 },
        placement: expect.objectContaining({
          issue: held,
          stateId: 'done',
          beforeId: 'first',
          afterId: 'target',
        }),
      },
    });
  });

  it('fails closed when equal-head target contents disagree', () => {
    const held = issue('held');
    const left = issue('target', { stateId: 'done', syncId: 2, sortOrder: 1024 });
    const right = issue('target', { stateId: 'done', syncId: 2, sortOrder: 2048 });

    expect(
      dragTargetSnapshotFor(
        [group('done', [left]), group('done', [right])],
        held,
        'target',
        'state',
        undefined,
        true,
      ).kind,
    ).toBe('ambiguous');
  });

  it('does not claim an ordinal when the board ordering cannot place the drop there', () => {
    const held = issue('held');
    const target = issue('target', { stateId: 'done', syncId: 2 });
    const snapshot = dragTargetSnapshotFor(
      [group('done', [target])],
      held,
      'target',
      'state',
      undefined,
      false,
    );

    expect(snapshot.kind).toBe('found');
    if (snapshot.kind !== 'found') throw new Error('missing drop target');
    expect(snapshot.target.destination).toEqual({ groupId: 'done', column: 'done' });
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

describe('when board positions are incomplete', () => {
  it('treats display-hidden rows like query-filtered rows', () => {
    expect(
      boardPositionsAreIncomplete(false, {
        ...defaultDisplayOptions('board'),
        showSubIssues: false,
      }),
    ).toBe(true);
    expect(
      boardPositionsAreIncomplete(false, {
        ...defaultDisplayOptions('board'),
        showCompleted: 'week',
      }),
    ).toBe(true);
    expect(boardPositionsAreIncomplete(false, defaultDisplayOptions('board'))).toBe(false);
  });
});
