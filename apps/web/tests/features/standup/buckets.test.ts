import { describe, expect, it } from 'bun:test';
import { bucketIssues, groupByAssignee, totalOf } from '../../../src/features/standup/buckets.ts';
import type { Issue, WorkflowState } from '../../../src/lib/query/schemas.ts';

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

describe('totalOf', () => {
  it('adds the three columns together', () => {
    const buckets = bucketIssues(
      [
        issue({ id: 'done', stateId: 'state_done' }),
        issue({ id: 'doing', stateId: 'state_doing' }),
        issue({ id: 'todo', stateId: 'state_todo' }),
      ],
      stateById,
    );

    expect(totalOf(buckets)).toBe(3);
  });
});
