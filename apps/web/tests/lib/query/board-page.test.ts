import { describe, expect, it } from 'bun:test';
import { emptyFilterGroup } from '@orbit/shared/filters';
import {
  boardSearch,
  columnParamFor,
  groupColumnSearch,
  type IssueQuery,
} from '@/lib/query/issue-search.ts';

const query: IssueQuery = { filter: emptyFilterGroup(), orderBy: 'manual' };

function params(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

describe('columnParamFor', () => {
  it('names the scope parameter for every grouping a column can be loaded by', () => {
    expect(columnParamFor('state')).toBe('stateId');
    expect(columnParamFor('assignee')).toBe('assigneeId');
    expect(columnParamFor('project')).toBe('projectId');
    expect(columnParamFor('cycle')).toBe('cycleId');
  });

  it('refuses a grouping the list endpoint cannot scope, so the board falls back', () => {
    expect(columnParamFor('priority')).toBeNull();
    expect(columnParamFor('label')).toBeNull();
    expect(columnParamFor('estimate')).toBeNull();
  });
});

describe('boardSearch', () => {
  it('asks for every column at once, carrying the scope and the grouping', () => {
    const search = params(boardSearch(query, 'state', { teamId: 'team_1' }));

    expect(search.get('groupBy')).toBe('state');
    expect(search.get('teamId')).toBe('team_1');
    expect(search.get('orderBy')).toBe('manual');
    expect(search.get('limit')).toBeNull();
  });

  it('passes a per column page size when one is asked for', () => {
    expect(params(boardSearch(query, 'state', {}, 10)).get('perGroup')).toBe('10');
  });
});

describe('groupColumnSearch', () => {
  it('scopes a column to its own group so the cache can hold it alone', () => {
    const search = params(groupColumnSearch(query, 'state', 'state_1', { teamId: 'team_1' }));

    expect(search.get('stateId')).toBe('state_1');
    expect(search.get('teamId')).toBe('team_1');
  });

  it('refuses the ungrouped column, which the list endpoint cannot scope', () => {
    expect(groupColumnSearch(query, 'assignee', 'none', { teamId: 'team_1' })).toBe('');
  });

  it('never lets a column widen past the scope it was given', () => {
    const search = params(groupColumnSearch(query, 'state', 's1', { projectId: 'apollo' }));

    expect(search.get('projectId')).toBe('apollo');
    expect(search.get('stateId')).toBe('s1');
  });

  it('returns nothing for a grouping that cannot be scoped', () => {
    expect(groupColumnSearch(query, 'priority', '1', {})).toBe('');
  });

  it('gives each column a different key, so they never share a cache entry', () => {
    const first = groupColumnSearch(query, 'state', 'state_1', { teamId: 'team_1' });
    const second = groupColumnSearch(query, 'state', 'state_2', { teamId: 'team_1' });

    expect(first).not.toBe(second);
  });
});
