import { describe, expect, it } from 'bun:test';
import { defaultDisplayOptions } from '@orbit/shared/filters';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { applyDisplayFilters, displayFiltersHideRows } from './display-filter.ts';

const NOW = Date.parse('2026-07-23T12:00:00.000Z');

const todo: WorkflowState = {
  id: 'state-todo',
  teamId: 'team-1',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 1,
};

const done: WorkflowState = {
  id: 'state-done',
  teamId: 'team-1',
  name: 'Done',
  category: 'completed',
  color: '#2e9e68',
  position: 2,
};

const states = new Map([
  [todo.id, todo],
  [done.id, done],
]);

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 'issue-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship it',
    description: '',
    stateId: todo.id,
    priority: 0,
    creatorId: 'user-1',
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

describe('display filters', () => {
  it('keeps everything by default and hides nothing', () => {
    const rows = [issue({ id: 'a' }), issue({ id: 'b', parentId: 'a' })];
    const result = applyDisplayFilters(rows, defaultDisplayOptions('list'), states, NOW);
    expect(result.issues).toHaveLength(2);
    expect(result.hidden).toBe(0);
  });

  it('hides sub-issues and counts exactly how many it hid', () => {
    const rows = [issue({ id: 'a' }), issue({ id: 'b', parentId: 'a' })];
    const display = { ...defaultDisplayOptions('list'), showSubIssues: false };
    const result = applyDisplayFilters(rows, display, states, NOW);
    expect(result.issues.map((row) => row.id)).toEqual(['a']);
    expect(result.hidden).toBe(1);
  });

  it('hides completed issues outside the chosen window', () => {
    const rows = [
      issue({ id: 'open' }),
      issue({
        id: 'fresh',
        stateId: done.id,
        completedAt: '2026-07-21T00:00:00.000Z',
      }),
      issue({ id: 'stale', stateId: done.id, completedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const display = { ...defaultDisplayOptions('list'), showCompleted: 'week' as const };
    const result = applyDisplayFilters(rows, display, states, NOW);
    expect(result.issues.map((row) => row.id)).toEqual(['open', 'fresh']);
    expect(result.hidden).toBe(1);
  });

  it('hides every completed issue when the window is none', () => {
    const rows = [
      issue({ id: 'open' }),
      issue({ id: 'closed', stateId: done.id, completedAt: '2026-07-23T00:00:00.000Z' }),
    ];
    const display = { ...defaultDisplayOptions('list'), showCompleted: 'none' as const };
    expect(applyDisplayFilters(rows, display, states, NOW).hidden).toBe(1);
  });

  it('knows when display options can hide rows at all', () => {
    expect(displayFiltersHideRows(defaultDisplayOptions('list'))).toBe(false);
    expect(displayFiltersHideRows({ ...defaultDisplayOptions('list'), showSubIssues: false })).toBe(
      true,
    );
    expect(
      displayFiltersHideRows({ ...defaultDisplayOptions('list'), showCompleted: 'week' }),
    ).toBe(true);
  });
});
