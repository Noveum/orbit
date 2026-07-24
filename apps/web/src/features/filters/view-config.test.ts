import { describe, expect, it } from 'bun:test';
import type { FilterGroup } from '@orbit/shared/filters';
import { conditionsOf, inCondition } from '@orbit/shared/filters';
import type { ViewConfig } from './view-config.ts';
import {
  applyCapabilities,
  defaultViewConfig,
  displayIsDefault,
  parseViewConfig,
  viewConfigFromState,
  viewConfigSearch,
  viewConfigToParams,
  viewConfigToState,
} from './view-config.ts';

const filter: FilterGroup = {
  kind: 'group',
  combinator: 'and',
  children: [inCondition('assignee', ['user-1', 'user-2']), inCondition('priority', ['1'], true)],
};

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

  it('round trips filters, grouping, sub grouping, ordering and every display option', () => {
    const config: ViewConfig = {
      filter,
      groupBy: 'assignee',
      subGroupBy: 'priority',
      orderBy: 'due',
      display: {
        showSubIssues: false,
        showEmptyGroups: true,
        showCompleted: 'week',
        properties: ['priority', 'assignee'],
      },
    };
    expect(roundTrip(config)).toEqual(config);
  });

  it('round trips a board config whose empty groups are turned off', () => {
    const base = defaultViewConfig('board');
    const config: ViewConfig = {
      ...base,
      filter,
      display: { ...base.display, showEmptyGroups: false },
    };
    expect(roundTrip(config, 'board')).toEqual(config);
  });

  it('round trips an empty property set', () => {
    const base = defaultViewConfig('list');
    const config: ViewConfig = { ...base, display: { ...base.display, properties: [] } };
    expect(roundTrip(config).display.properties).toEqual([]);
  });

  it('round trips a reordered property set of the same size', () => {
    const base = defaultViewConfig('list');
    const config: ViewConfig = {
      ...base,
      display: {
        ...base.display,
        properties: ['assignee', 'estimate', 'labels', 'status', 'identifier', 'priority'],
      },
    };
    expect(viewConfigToParams(config, 'list').get('props')).not.toBeNull();
    expect(roundTrip(config).display.properties).toEqual(config.display.properties);
  });

  it('writes only the parameters that differ from the defaults', () => {
    const params = viewConfigToParams({ ...defaultViewConfig('list'), filter }, 'list');
    expect([...params.keys()]).toEqual(['filter']);
    expect(conditionsOf(roundTrip({ ...defaultViewConfig('list'), filter }).filter)).toEqual(
      conditionsOf(filter),
    );
  });

  it('survives a full url string, which is what the back button replays', () => {
    const config: ViewConfig = {
      filter,
      groupBy: 'project',
      subGroupBy: 'assignee',
      orderBy: 'updated',
      display: {
        showSubIssues: false,
        showEmptyGroups: true,
        showCompleted: 'none',
        properties: ['identifier', 'status'],
      },
    };
    const search = viewConfigSearch(config, 'list');
    expect(parseViewConfig(new URLSearchParams(search.slice(1)), 'list')).toEqual(config);
  });

  it('falls back to the supplied base for parameters the url leaves out', () => {
    const base: ViewConfig = {
      ...defaultViewConfig('list'),
      groupBy: 'project',
      orderBy: 'updated',
    };
    const parsed = parseViewConfig(
      new URLSearchParams(`filter=${encodeURIComponent(JSON.stringify(filter))}`),
      'list',
      base,
    );
    expect(parsed.groupBy).toBe('project');
    expect(parsed.orderBy).toBe('updated');
    expect(conditionsOf(parsed.filter)).toEqual(conditionsOf(filter));
  });

  it('ignores values that are not part of the contract', () => {
    const parsed = parseViewConfig(
      new URLSearchParams('group=nonsense&order=sideways&props=priority,bogus&sub=maybe&done=soon'),
      'list',
    );
    expect(parsed.groupBy).toBe('state');
    expect(parsed.orderBy).toBe('manual');
    expect(parsed.display.properties).toEqual(['priority']);
    expect(parsed.display.showSubIssues).toBe(true);
    expect(parsed.display.showCompleted).toBe('all');
  });
});

describe('display modified badge', () => {
  it('is quiet on a default view and lit once anything changes', () => {
    expect(displayIsDefault(defaultViewConfig('list'), 'list')).toBe(true);
    expect(displayIsDefault({ ...defaultViewConfig('list'), groupBy: 'assignee' }, 'list')).toBe(
      false,
    );
    const base = defaultViewConfig('list');
    expect(
      displayIsDefault({ ...base, display: { ...base.display, showCompleted: 'week' } }, 'list'),
    ).toBe(false);
  });
});

describe('view config to stored view', () => {
  it('keeps every part of the configuration a saved view has to carry', () => {
    const config: ViewConfig = {
      ...defaultViewConfig('list'),
      filter,
      groupBy: 'label',
      subGroupBy: 'assignee',
      orderBy: 'priority',
    };
    const state = viewConfigToState(config, 'list', { teamId: 'team-1', projectId: null });
    expect(state.teamId).toBe('team-1');
    expect(state.layout).toBe('list');
    expect(state.groupBy).toBe('label');
    expect(state.subGroupBy).toBe('assignee');
    expect(state.orderBy).toBe('priority');
    expect(viewConfigFromState(state)).toEqual(config);
  });

  it('carries visibility and the lock through', () => {
    const state = viewConfigToState(
      defaultViewConfig('board'),
      'board',
      { teamId: null, projectId: null },
      { visibility: 'workspace', locked: true },
    );
    expect(state.visibility).toBe('workspace');
    expect(state.locked).toBe(true);
  });
});

describe('capability matrix applied to a config', () => {
  it('drops the project filter and grouping on a project page', () => {
    const config: ViewConfig = {
      ...defaultViewConfig('list'),
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [inCondition('project', ['p1']), inCondition('state', ['s1'])],
      },
      groupBy: 'project',
    };
    const sanitized = applyCapabilities(config, 'project', 'list');
    expect(conditionsOf(sanitized.filter).map((entry) => entry.property)).toEqual(['state']);
    expect(sanitized.groupBy).not.toBe('project');
  });

  it('drops sub grouping when the layout switches to a board', () => {
    const config: ViewConfig = {
      ...defaultViewConfig('list'),
      groupBy: 'state',
      subGroupBy: 'assignee',
    };
    expect(applyCapabilities(config, 'team', 'board').subGroupBy).toBe('none');
    expect(applyCapabilities(config, 'team', 'list').subGroupBy).toBe('assignee');
  });
});
