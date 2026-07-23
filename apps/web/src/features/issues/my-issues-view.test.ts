import { describe, expect, it } from 'vitest';
import type { Issue } from '@/lib/query/schemas.ts';
import { assignedTo } from './my-issues-view.tsx';

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_eng',
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship it',
    description: '',
    stateId: 'state_todo',
    priority: 0,
    creatorId: 'user_1',
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
    stateEnteredAt: '2026-01-01T00:00:00.000Z',
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  };
}

describe('assignedTo', () => {
  it('keeps only the viewer issues and orders them', () => {
    const rows = assignedTo(
      [
        issue({ id: 'a', identifier: 'ENG-1', assigneeId: 'me', sortOrder: 200 }),
        issue({ id: 'b', identifier: 'DES-1', teamId: 'team_des', assigneeId: 'you' }),
        issue({
          id: 'c',
          identifier: 'DES-2',
          teamId: 'team_des',
          assigneeId: 'me',
          sortOrder: 10,
        }),
      ],
      'me',
    );
    expect(rows.map((row) => row.identifier)).toEqual(['DES-2', 'ENG-1']);
  });

  it('returns nothing before the viewer is known', () => {
    expect(assignedTo([issue({ assigneeId: 'me' })], null)).toEqual([]);
  });
});
