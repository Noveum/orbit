import { describe, expect, it } from 'bun:test';
import {
  bucketIssues,
  groupByAssignee,
  nextSpeaker,
  orderRoster,
  readingOrder,
  shuffle,
  stageGroups,
  standupRoster,
} from '../../../src/features/standup/buckets.ts';
import type { Issue, Member, WorkflowState } from '../../../src/lib/query/schemas.ts';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_eng',
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship the board',
    description: '',
    stateId: 'state_todo',
    priority: 0,
    creatorId: 'user_1',
    assigneeId: 'user_1',
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
    stateEnteredAt: '2026-06-01T00:00:00.000Z',
    syncId: 1,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  };
}

function state(id: string, category: string): WorkflowState {
  return { id, teamId: 'team_eng', name: id, category, color: '#666666', position: 0 };
}

const stateById = new Map<string, WorkflowState>([
  ['state_triage', state('state_triage', 'triage')],
  ['state_backlog', state('state_backlog', 'backlog')],
  ['state_todo', state('state_todo', 'unstarted')],
  ['state_doing', state('state_doing', 'started')],
  ['state_review', state('state_review', 'review')],
  ['state_done', state('state_done', 'completed')],
  ['state_dropped', state('state_dropped', 'canceled')],
]);

describe('groupByAssignee', () => {
  it('keys every issue by the person who owns it', () => {
    const grouped = groupByAssignee([
      issue({ id: 'a', assigneeId: 'user_1' }),
      issue({ id: 'b', assigneeId: 'user_2' }),
      issue({ id: 'c', assigneeId: 'user_1' }),
    ]);

    expect(grouped.get('user_1')?.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(grouped.get('user_2')?.map((entry) => entry.id)).toEqual(['b']);
  });

  it('drops unassigned work rather than inventing an owner', () => {
    const grouped = groupByAssignee([
      issue({ id: 'a', assigneeId: null }),
      issue({ id: 'b', assigneeId: 'user_2' }),
    ]);

    expect([...grouped.keys()]).toEqual(['user_2']);
  });
});

describe('bucketIssues', () => {
  it('sends completed and canceled work to the closed column', () => {
    const buckets = bucketIssues(
      [
        issue({ id: 'done', stateId: 'state_done' }),
        issue({ id: 'dropped', stateId: 'state_dropped' }),
      ],
      stateById,
    );

    expect(buckets.closed.map((entry) => entry.id)).toEqual(['done', 'dropped']);
    expect(buckets.inFlight).toHaveLength(0);
    expect(buckets.upNext).toHaveLength(0);
  });

  it('counts review as in progress alongside started', () => {
    const buckets = bucketIssues(
      [
        issue({ id: 'doing', stateId: 'state_doing' }),
        issue({ id: 'review', stateId: 'state_review' }),
      ],
      stateById,
    );

    expect(buckets.inFlight.map((entry) => entry.id)).toEqual(['doing', 'review']);
  });

  it('puts triage, backlog and unstarted work up next', () => {
    const buckets = bucketIssues(
      [
        issue({ id: 'triage', stateId: 'state_triage', sortOrder: 3 }),
        issue({ id: 'backlog', stateId: 'state_backlog', sortOrder: 2 }),
        issue({ id: 'todo', stateId: 'state_todo', sortOrder: 1 }),
      ],
      stateById,
    );

    expect(buckets.upNext).toHaveLength(3);
  });

  it('shows an issue whose state is unknown instead of dropping it', () => {
    const buckets = bucketIssues([issue({ id: 'orphan', stateId: 'state_missing' })], stateById);

    expect(buckets.upNext.map((entry) => entry.id)).toEqual(['orphan']);
  });

  it('reads the up next column in backlog order', () => {
    const buckets = bucketIssues(
      [
        issue({ id: 'third', identifier: 'ENG-3', stateId: 'state_todo', sortOrder: 3000 }),
        issue({ id: 'first', identifier: 'ENG-1', stateId: 'state_todo', sortOrder: 1000 }),
        issue({ id: 'second', identifier: 'ENG-2', stateId: 'state_todo', sortOrder: 2000 }),
      ],
      stateById,
    );

    expect(buckets.upNext.map((entry) => entry.id)).toEqual(['first', 'second', 'third']);
  });

  it('keeps the server order inside the closed column', () => {
    const buckets = bucketIssues(
      [
        issue({ id: 'newer', stateId: 'state_done', sortOrder: 9000 }),
        issue({ id: 'older', stateId: 'state_done', sortOrder: 10 }),
      ],
      stateById,
    );

    expect(buckets.closed.map((entry) => entry.id)).toEqual(['newer', 'older']);
  });
});

describe('readingOrder', () => {
  it('reads in progress first, then what is queued, then what is already closed', () => {
    const buckets = bucketIssues(
      [
        issue({ id: 'done', stateId: 'state_done' }),
        issue({ id: 'todo', stateId: 'state_todo' }),
        issue({ id: 'doing', stateId: 'state_doing' }),
      ],
      stateById,
    );

    expect(readingOrder(buckets).map((entry) => entry.id)).toEqual(['doing', 'todo', 'done']);
  });
});

function member(id: string, name: string): Member {
  return { id, name, email: `${id}@orbit.test`, image: null, handle: null, role: 'member' };
}

const roster: readonly Member[] = [
  member('user_cy', 'Cy Diaz'),
  member('user_ada', 'Ada Lovelace'),
  member('user_bo', 'Bo Chen'),
];

describe('standupRoster', () => {
  it('gives every person with work an entry, ordered by name', () => {
    const entries = standupRoster(
      [
        issue({ id: 'a', assigneeId: 'user_cy' }),
        issue({ id: 'b', assigneeId: 'user_ada' }),
        issue({ id: 'c', assigneeId: 'user_bo' }),
      ],
      roster,
      [],
      stateById,
    );

    expect(entries.map((entry) => entry.member.name)).toEqual([
      'Ada Lovelace',
      'Bo Chen',
      'Cy Diaz',
    ]);
  });

  it('leaves out a person the window found no work for', () => {
    const entries = standupRoster(
      [issue({ id: 'a', assigneeId: 'user_bo' })],
      roster,
      [{ userId: 'user_bo', open: 1, inProgress: 0, completedSince: 0 }],
      stateById,
    );

    expect(entries.map((entry) => entry.member.id)).toEqual(['user_bo']);
  });

  it('stacks an entry in progress, up next, closed', () => {
    const entries = standupRoster(
      [
        issue({ id: 'done', assigneeId: 'user_ada', stateId: 'state_done' }),
        issue({ id: 'todo', assigneeId: 'user_ada', stateId: 'state_todo' }),
        issue({ id: 'doing', assigneeId: 'user_ada', stateId: 'state_doing' }),
      ],
      roster,
      [],
      stateById,
    );

    expect(entries[0]?.issues.map((row) => row.id)).toEqual(['doing', 'todo', 'done']);
  });

  it('carries the server count so a capped tile can own up to it', () => {
    const entries = standupRoster(
      [issue({ id: 'a', assigneeId: 'user_ada', stateId: 'state_doing' })],
      roster,
      [{ userId: 'user_ada', open: 12, inProgress: 4, completedSince: 3 }],
      stateById,
    );

    expect(entries[0]?.total).toBe(15);
  });

  it('never claims fewer than the cards it hands over', () => {
    const entries = standupRoster(
      [
        issue({ id: 'a', assigneeId: 'user_ada', stateId: 'state_done' }),
        issue({ id: 'b', assigneeId: 'user_ada', stateId: 'state_done' }),
      ],
      roster,
      [{ userId: 'user_ada', open: 0, inProgress: 0, completedSince: 1 }],
      stateById,
    );

    expect(entries[0]?.total).toBe(2);
  });

  it('skips work owned by somebody who is not in the workspace roster', () => {
    const entries = standupRoster(
      [issue({ id: 'a', assigneeId: 'user_ghost' })],
      roster,
      [{ userId: 'user_ghost', open: 1, inProgress: 0, completedSince: 0 }],
      stateById,
    );

    expect(entries).toHaveLength(0);
  });
});

describe('stageGroups', () => {
  it('splits the work of one person into a column per stage, in workflow order', () => {
    const groups = stageGroups(
      [
        issue({ id: 'done', stateId: 'state_done' }),
        issue({ id: 'doing', stateId: 'state_doing' }),
        issue({ id: 'todo', stateId: 'state_todo' }),
      ],
      stateById,
    );

    expect(groups.map((group) => group.title)).toEqual(['Todo', 'In Progress', 'Done']);
    expect(groups.map((group) => group.category)).toEqual(['unstarted', 'started', 'completed']);
  });

  it('leaves out a stage nobody has work in rather than showing an empty column', () => {
    const groups = stageGroups([issue({ id: 'a', stateId: 'state_doing' })], stateById);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe('started');
  });

  it('drops an issue whose state is not in the workspace', () => {
    const groups = stageGroups([issue({ id: 'a', stateId: 'state_missing' })], stateById);

    expect(groups).toEqual([]);
  });

  it('returns nothing for a person carrying nothing', () => {
    expect(stageGroups([], stateById)).toEqual([]);
  });
});

describe('shuffle', () => {
  it('keeps every member exactly once', () => {
    const order = shuffle(['a', 'b', 'c', 'd'], () => 0.5);

    expect([...order].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reorders with the randomness it is handed', () => {
    expect(shuffle(['a', 'b', 'c'], () => 0)).toEqual(['b', 'c', 'a']);
  });

  it('leaves the array it was given alone', () => {
    const original = ['a', 'b', 'c'];
    shuffle(original, () => 0);

    expect(original).toEqual(['a', 'b', 'c']);
  });
});

describe('orderRoster', () => {
  it('falls back to the roster order when nobody has shuffled', () => {
    const entries = standupRoster(
      [issue({ id: 'a', assigneeId: 'user_ada' }), issue({ id: 'b', assigneeId: 'user_bo' })],
      roster,
      [],
      stateById,
    );

    expect(orderRoster(entries, []).map((entry) => entry.member.id)).toEqual([
      'user_ada',
      'user_bo',
    ]);
  });

  it('puts the roster into the shuffled order', () => {
    const entries = standupRoster(
      [issue({ id: 'a', assigneeId: 'user_ada' }), issue({ id: 'b', assigneeId: 'user_bo' })],
      roster,
      [],
      stateById,
    );

    expect(orderRoster(entries, ['user_bo', 'user_ada']).map((entry) => entry.member.id)).toEqual([
      'user_bo',
      'user_ada',
    ]);
  });

  it('keeps somebody the order does not mention, at the end', () => {
    const entries = standupRoster(
      [issue({ id: 'a', assigneeId: 'user_ada' }), issue({ id: 'b', assigneeId: 'user_bo' })],
      roster,
      [],
      stateById,
    );

    expect(orderRoster(entries, ['user_bo']).map((entry) => entry.member.id)).toEqual([
      'user_bo',
      'user_ada',
    ]);
  });
});

describe('nextSpeaker', () => {
  const entries = standupRoster(
    [
      issue({ id: 'a', assigneeId: 'user_ada' }),
      issue({ id: 'b', assigneeId: 'user_bo' }),
      issue({ id: 'c', assigneeId: 'user_cy' }),
    ],
    roster,
    [],
    stateById,
  );

  it('starts at the top when nobody has spoken', () => {
    expect(nextSpeaker(entries, null, new Set())).toBe('user_ada');
  });

  it('moves to the next person in order', () => {
    expect(nextSpeaker(entries, 'user_ada', new Set(['user_ada']))).toBe('user_bo');
  });

  it('skips somebody who has already spoken', () => {
    expect(nextSpeaker(entries, 'user_ada', new Set(['user_ada', 'user_bo']))).toBe('user_cy');
  });

  it('wraps around to somebody skipped earlier', () => {
    expect(nextSpeaker(entries, 'user_cy', new Set(['user_cy', 'user_bo']))).toBe('user_ada');
  });

  it('gives back nothing once everybody has spoken', () => {
    expect(nextSpeaker(entries, 'user_cy', new Set(['user_ada', 'user_bo', 'user_cy']))).toBeNull();
  });

  it('gives back nothing when there is nobody on the board', () => {
    expect(nextSpeaker([], null, new Set())).toBeNull();
  });
});
