import { describe, expect, it } from 'bun:test';
import type { FilterGroup } from '@orbit/shared/filters';
import { emptyFilterGroup } from '@orbit/shared/filters';
import {
  DEFAULT_ISSUE_QUERY,
  facetsSearch,
  summarySearch,
} from '../../../src/lib/query/issue-search.ts';

function assignedTo(userId: string): FilterGroup {
  return {
    kind: 'group',
    combinator: 'and',
    children: [
      { kind: 'condition', property: 'assignee', operator: 'in', values: [userId], negate: false },
    ],
  };
}

describe('what a filter change costs', () => {
  it('changes the summary key, because the counts it holds are filtered counts', () => {
    const unfiltered = summarySearch('team_1', DEFAULT_ISSUE_QUERY, 'state');
    const filtered = summarySearch(
      'team_1',
      { filter: assignedTo('user_1'), orderBy: 'manual' },
      'state',
    );

    expect(filtered).not.toBe(unfiltered);
    expect(filtered).toContain('filter=');
  });

  it('leaves the facet key alone, so the scope wide counts stay cached', () => {
    const unfiltered = facetsSearch('team_1');
    const filtered = facetsSearch('team_1');

    expect(filtered).toBe(unfiltered);
    expect(facetsSearch('team_1')).toBe('teamId=team_1');
  });

  it('still separates one scope from another', () => {
    expect(facetsSearch('team_1')).not.toBe(facetsSearch('team_2'));
    expect(facetsSearch(null, { projectId: 'proj_1' })).toBe('projectId=proj_1');
    expect(facetsSearch(null)).toBe('');
  });

  it('carries neither the ordering nor the page size, which cannot change a count', () => {
    const search = facetsSearch('team_1', { cycleId: 'cycle_1' });

    expect(search).not.toContain('orderBy');
    expect(search).not.toContain('limit');
    expect(search).toContain('cycleId=cycle_1');
  });

  it('keeps an empty filter group out of the summary key', () => {
    expect(
      summarySearch('team_1', { filter: emptyFilterGroup(), orderBy: 'manual' }, 'state'),
    ).not.toContain('filter=');
  });
});
