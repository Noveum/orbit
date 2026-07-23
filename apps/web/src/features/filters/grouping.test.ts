import { describe, expect, it } from 'vitest';
import type { Issue } from '@/lib/query/schemas.ts';
import type { GroupContext } from './grouping.ts';
import { groupIssues, groupKeysOf } from './grouping.ts';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 1,
    identifier: 'ENG-1',
    title: 'An issue',
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

const context: GroupContext = {
  states: [
    {
      id: 'state_todo',
      teamId: 'team_1',
      name: 'Todo',
      category: 'unstarted',
      color: '#5d6272',
      position: 1,
    },
  ],
  members: [],
  projects: [{ id: 'project_1', name: 'Atlas', status: 'planned', color: '#5a63c8', icon: 'box' }],
  cycles: [],
  labels: [
    { id: 'label_bug', teamId: null, name: 'Bug', color: '#cc4b4b' },
    { id: 'label_perf', teamId: null, name: 'Performance', color: '#c78a2e' },
  ],
};

const options = { showEmptyGroups: false, ordering: 'manual' } as const;

describe('groupKeysOf', () => {
  it('places an issue with several labels in each of their groups', () => {
    expect(groupKeysOf(issue({ labelIds: ['label_bug', 'label_perf'] }), 'label')).toEqual([
      'label_bug',
      'label_perf',
    ]);
  });

  it('falls back to the unset bucket when a field is empty', () => {
    expect(groupKeysOf(issue(), 'label')).toEqual(['none']);
    expect(groupKeysOf(issue(), 'assignee')).toEqual(['none']);
    expect(groupKeysOf(issue(), 'project')).toEqual(['none']);
    expect(groupKeysOf(issue(), 'cycle')).toEqual(['none']);
    expect(groupKeysOf(issue(), 'none')).toEqual(['all']);
  });
});

describe('groupIssues', () => {
  it('lists priorities urgent first and no priority last', () => {
    const groups = groupIssues(
      [
        issue({ id: 'a', priority: 0 }),
        issue({ id: 'b', priority: 4 }),
        issue({ id: 'c', priority: 1 }),
      ],
      'priority',
      context,
      options,
    );
    expect(groups.map((group) => group.title)).toEqual(['Urgent', 'Low', 'No priority']);
  });

  it('shows a multi labelled issue under every label it carries', () => {
    const groups = groupIssues(
      [issue({ id: 'a', labelIds: ['label_bug', 'label_perf'] }), issue({ id: 'b' })],
      'label',
      context,
      options,
    );
    expect(groups.map((group) => group.title)).toEqual(['Bug', 'Performance', 'No label']);
    expect(groups.map((group) => group.issues.length)).toEqual([1, 1, 1]);
  });

  it('collapses everything into one group when grouping is off', () => {
    const groups = groupIssues([issue({ id: 'a' }), issue({ id: 'b' })], 'none', context, options);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.issues).toHaveLength(2);
  });

  it('keeps the server order unless the ordering is manual', () => {
    const rows = [issue({ id: 'a', sortOrder: 4096 }), issue({ id: 'b', sortOrder: 1 })];
    expect(
      groupIssues(rows, 'none', context, {
        showEmptyGroups: false,
        ordering: 'manual',
      })[0]?.issues.map((entry) => entry.id),
    ).toEqual(['b', 'a']);
    expect(
      groupIssues(rows, 'none', context, {
        showEmptyGroups: false,
        ordering: 'priority',
      })[0]?.issues.map((entry) => entry.id),
    ).toEqual(['a', 'b']);
  });

  it('drops empty groups unless they are asked for', () => {
    expect(groupIssues([], 'state', context, options)).toEqual([]);
    expect(
      groupIssues([], 'state', context, { showEmptyGroups: true, ordering: 'manual' }),
    ).toHaveLength(1);
  });
});
