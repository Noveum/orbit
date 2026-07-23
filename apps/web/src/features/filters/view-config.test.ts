import type { FilterPredicate } from '@orbit/shared/filters';
import { describe, expect, it } from 'vitest';
import type { ViewConfig } from './view-config.ts';
import {
  defaultViewConfig,
  parseViewConfig,
  viewConfigFromStored,
  viewConfigSearch,
  viewConfigToFilter,
  viewConfigToParams,
} from './view-config.ts';

const predicates: FilterPredicate[] = [
  { field: 'assignee', operator: 'is', values: ['user-1', 'user-2'] },
  { field: 'priority', operator: 'is_not', values: ['1'] },
];

function roundTrip(config: ViewConfig, layout: 'list' | 'board' = 'list'): ViewConfig {
  return parseViewConfig(viewConfigToParams(config, layout), layout);
}

describe('view config url round trip', () => {
  it('returns an empty query for the default config', () => {
    expect(viewConfigSearch(defaultViewConfig('list'), 'list')).toBe('');
    expect(viewConfigSearch(defaultViewConfig('board'), 'board')).toBe('');
  });

  it('parses the defaults back from an empty query', () => {
    expect(parseViewConfig(new URLSearchParams(), 'list')).toEqual(defaultViewConfig('list'));
    expect(parseViewConfig(new URLSearchParams(), 'board')).toEqual(defaultViewConfig('board'));
  });

  it('round trips filters, grouping, ordering and toggles identically', () => {
    const config: ViewConfig = {
      predicates,
      groupBy: 'assignee',
      orderBy: 'due',
      showSubIssues: false,
      showEmptyGroups: true,
      properties: ['priority', 'assignee'],
    };
    expect(roundTrip(config)).toEqual(config);
  });

  it('round trips a board config whose empty groups are turned off', () => {
    const config: ViewConfig = {
      ...defaultViewConfig('board'),
      predicates,
      showEmptyGroups: false,
    };
    expect(roundTrip(config, 'board')).toEqual(config);
  });

  it('round trips an empty property set', () => {
    const config: ViewConfig = { ...defaultViewConfig('list'), properties: [] };
    expect(roundTrip(config)).toEqual(config);
  });

  it('writes only the parameters that differ from the defaults', () => {
    const params = viewConfigToParams({ ...defaultViewConfig('list'), predicates }, 'list');
    expect([...params.keys()]).toEqual(['filter']);
    expect(params.get('filter')).toBe('assignee:is:user-1,user-2;priority:is_not:1');
  });

  it('falls back to the supplied base for parameters the url leaves out', () => {
    const base: ViewConfig = {
      ...defaultViewConfig('list'),
      groupBy: 'project',
      orderBy: 'updated',
    };
    const parsed = parseViewConfig(new URLSearchParams('filter=due:is:overdue'), 'list', base);
    expect(parsed.groupBy).toBe('project');
    expect(parsed.orderBy).toBe('updated');
    expect(parsed.predicates).toEqual([{ field: 'due', operator: 'is', values: ['overdue'] }]);
  });

  it('ignores values that are not part of the contract', () => {
    const parsed = parseViewConfig(
      new URLSearchParams('group=nonsense&order=sideways&props=priority,bogus&sub=maybe'),
      'list',
    );
    expect(parsed.groupBy).toBe('state');
    expect(parsed.orderBy).toBe('manual');
    expect(parsed.properties).toEqual(['priority']);
    expect(parsed.showSubIssues).toBe(true);
  });
});

describe('view config to stored view', () => {
  it('keeps the filters, ordering and sub issue toggle', () => {
    const config: ViewConfig = {
      ...defaultViewConfig('list'),
      predicates,
      orderBy: 'priority',
      showSubIssues: false,
    };
    expect(viewConfigToFilter(config)).toEqual({
      predicates,
      orderBy: 'priority',
      includeSubIssues: false,
    });
  });

  it('rebuilds the config a saved view describes', () => {
    const restored = viewConfigFromStored(
      { predicates, orderBy: 'created', includeSubIssues: false },
      'label',
      'board',
    );
    expect(restored).toEqual({
      ...defaultViewConfig('board'),
      predicates,
      groupBy: 'label',
      orderBy: 'created',
      showSubIssues: false,
    });
  });

  it('survives a view saved before a field existed', () => {
    expect(viewConfigFromStored({}, 'state', 'list')).toEqual(defaultViewConfig('list'));
  });
});
