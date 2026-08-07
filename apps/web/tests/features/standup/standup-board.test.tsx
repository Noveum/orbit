import { describe, expect, it } from 'bun:test';
import { assigneeCounts } from '../../../src/features/standup/standup-board.tsx';
import type { Issue } from '../../../src/lib/query/schemas.ts';

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
    creatorId: 'user_ada',
    assigneeId: 'user_ada',
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
    stateEnteredAt: '2026-06-08T00:00:00.000Z',
    syncId: 1,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  };
}

describe('assigneeCounts', () => {
  it('counts what each person is carrying', () => {
    const counts = assigneeCounts([
      issue({ id: 'a', assigneeId: 'user_ada' }),
      issue({ id: 'b', assigneeId: 'user_ada' }),
      issue({ id: 'c', assigneeId: 'user_bo' }),
    ]);

    expect(counts.get('user_ada')).toBe(2);
    expect(counts.get('user_bo')).toBe(1);
  });

  it('leaves unassigned work out of the tally', () => {
    const counts = assigneeCounts([
      issue({ id: 'a', assigneeId: null }),
      issue({ id: 'b', assigneeId: 'user_ada' }),
    ]);

    expect(counts.size).toBe(1);
    expect(counts.get('user_ada')).toBe(1);
  });

  it('gives back nothing for an empty board', () => {
    expect(assigneeCounts([]).size).toBe(0);
  });
});
