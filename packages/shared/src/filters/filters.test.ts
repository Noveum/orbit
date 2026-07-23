import { describe, expect, it } from 'bun:test';
import { issueFilterSchema } from '../validators/index.ts';
import type { FilterCondition, FilterGroup, FilterNode } from './index.ts';
import {
  capabilityFor,
  conditionFor,
  conditionsOf,
  countConditions,
  decodeFilter,
  defaultDisplayOptions,
  defaultViewState,
  describeRelative,
  dropLastCondition,
  emptyFilterGroup,
  encodeFilter,
  filterGroupSchema,
  inCondition,
  isVirtualViewId,
  MAX_FILTER_CONDITIONS,
  removeCondition,
  replaceCondition,
  resolveRelativeRange,
  sanitizeViewConfig,
  supportsOperator,
  VIRTUAL_VIEW_IDS,
  viewStateDirty,
  viewStateFrom,
  viewStateSchema,
  virtualViewState,
} from './index.ts';

function group(...children: FilterNode[]): FilterGroup {
  return { kind: 'group', combinator: 'and', children };
}

const conditions: FilterCondition[] = [
  inCondition('state', ['state-a', 'state-b']),
  inCondition('assignee', ['user-1'], true),
  inCondition('due', ['overdue', 'this_week']),
];

const tree = group(...conditions);

describe('filter tree parsing', () => {
  it('accepts a flat and group of conditions', () => {
    const parsed = filterGroupSchema.parse(tree);
    expect(conditionsOf(parsed).map((entry) => entry.property)).toEqual([
      'state',
      'assignee',
      'due',
    ]);
  });

  it('rejects an unknown property', () => {
    expect(() =>
      filterGroupSchema.parse(
        group({ kind: 'condition', property: 'nope', operator: 'in', values: ['x'] } as never),
      ),
    ).toThrow();
  });

  it('rejects an operator the property does not support', () => {
    expect(supportsOperator('state', 'relative')).toBe(false);
    expect(() =>
      filterGroupSchema.parse(
        group({
          kind: 'condition',
          property: 'state',
          operator: 'relative',
          relative: { unit: 'week', offset: 1, direction: 'past' },
        } as never),
      ),
    ).toThrow();
  });

  it('accepts nesting up to depth five and rejects depth six', () => {
    const nest = (depth: number): FilterNode =>
      depth === 1 ? inCondition('priority', ['1']) : group(nest(depth - 1));
    expect(() => filterGroupSchema.parse(nest(5))).not.toThrow();
    expect(() => filterGroupSchema.parse(nest(6))).toThrow();
  });

  it('rejects more conditions than the ceiling allows', () => {
    const many = group(
      ...Array.from({ length: MAX_FILTER_CONDITIONS + 1 }, () => inCondition('priority', ['1'])),
    );
    expect(() => filterGroupSchema.parse(many)).toThrow();
  });

  it('rejects a range with no bound at all', () => {
    expect(() =>
      filterGroupSchema.parse(
        group({ kind: 'condition', property: 'due', operator: 'range' } as never),
      ),
    ).toThrow();
  });

  it('counts conditions across nested groups', () => {
    expect(
      countConditions(group(inCondition('state', ['a']), group(inCondition('due', ['none'])))),
    ).toBe(2);
  });
});

describe('filter url round trip', () => {
  it('round trips a tree through the url form without losing anything', () => {
    expect(decodeFilter(encodeFilter(tree))).toEqual(filterGroupSchema.parse(tree));
  });

  it('round trips a nested or group', () => {
    const nested: FilterGroup = {
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'group',
          combinator: 'or',
          children: [inCondition('priority', ['1']), inCondition('label', ['label-a'])],
        },
      ],
    };
    expect(decodeFilter(encodeFilter(nested))).toEqual(filterGroupSchema.parse(nested));
  });

  it('encodes an empty tree to an empty string', () => {
    expect(encodeFilter(emptyFilterGroup())).toBe('');
    expect(decodeFilter('')).toEqual(emptyFilterGroup());
  });

  it('falls back to an empty tree on rubbish', () => {
    expect(decodeFilter('{not json')).toEqual(emptyFilterGroup());
    expect(decodeFilter('{"kind":"group","children":[{"property":"bogus"}]}')).toEqual(
      emptyFilterGroup(),
    );
  });

  it('rejects values carrying separator or script characters', () => {
    expect(decodeFilter(JSON.stringify(group(inCondition('state', ['<script>']))))).toEqual(
      emptyFilterGroup(),
    );
  });
});

describe('relative dates', () => {
  it('resolves the next two weeks from whatever today is', () => {
    expect(
      resolveRelativeRange({ unit: 'week', offset: 2, direction: 'future' }, '2026-07-23'),
    ).toEqual({ from: '2026-07-23', to: '2026-08-06' });
  });

  it('moves with the calendar so a saved view still means the next two weeks tomorrow', () => {
    const relative = { unit: 'week', offset: 2, direction: 'future' } as const;
    const today = resolveRelativeRange(relative, '2026-07-23');
    const tomorrow = resolveRelativeRange(relative, '2026-07-24');
    expect(tomorrow).not.toEqual(today);
    expect(tomorrow).toEqual({ from: '2026-07-24', to: '2026-08-07' });
  });

  it('resolves a past window backwards', () => {
    expect(
      resolveRelativeRange({ unit: 'day', offset: 3, direction: 'past' }, '2026-01-02'),
    ).toEqual({ from: '2025-12-30', to: '2026-01-02' });
  });

  it('survives being saved and reopened', () => {
    const saved = group({
      kind: 'condition',
      property: 'due',
      operator: 'relative',
      negate: false,
      relative: { unit: 'week', offset: 2, direction: 'future' },
    });
    const reopened = decodeFilter(encodeFilter(saved));
    const condition = conditionFor(reopened, 'due');
    expect(condition?.operator).toBe('relative');
    if (condition?.operator !== 'relative') throw new Error('The relative filter was lost.');
    expect(describeRelative(condition.relative)).toBe('in the next 2 weeks');
  });
});

describe('issueFilterSchema filter', () => {
  it('parses the url string form', () => {
    const parsed = issueFilterSchema.parse({
      filter: encodeFilter(group(inCondition('priority', ['1', '2']))),
    });
    expect(conditionsOf(parsed.filter)).toEqual([inCondition('priority', ['1', '2'])]);
  });

  it('parses the stored json form', () => {
    const parsed = issueFilterSchema.parse({ filter: tree });
    expect(conditionsOf(parsed.filter)).toEqual(conditions);
  });

  it('defaults to no filter', () => {
    expect(issueFilterSchema.parse({}).filter).toEqual(emptyFilterGroup());
  });

  it('reads boolean flags from url strings', () => {
    expect(issueFilterSchema.parse({ includeSubIssues: 'false' }).includeSubIssues).toBe(false);
    expect(issueFilterSchema.parse({ includeArchived: true }).includeArchived).toBe(true);
  });

  it('refuses an unknown property', () => {
    expect(() =>
      issueFilterSchema.parse({
        filter: { kind: 'group', combinator: 'and', children: [{ property: 'nope' }] },
      }),
    ).toThrow();
  });
});

describe('condition helpers', () => {
  it('replaces the condition that already covers a property', () => {
    const next = replaceCondition(tree, inCondition('assignee', ['user-2']));
    expect(next.children).toHaveLength(3);
    expect(conditionFor(next, 'assignee')).toEqual(inCondition('assignee', ['user-2']));
  });

  it('appends a condition for a property that is not filtered yet', () => {
    const next = replaceCondition(tree, inCondition('label', ['label-1']));
    expect(next.children).toHaveLength(4);
  });

  it('removes one property and leaves the rest', () => {
    expect(conditionsOf(removeCondition(tree, 'state')).map((entry) => entry.property)).toEqual([
      'assignee',
      'due',
    ]);
  });

  it('drops only the last condition', () => {
    expect(conditionsOf(dropLastCondition(tree)).map((entry) => entry.property)).toEqual([
      'state',
      'assignee',
    ]);
    expect(dropLastCondition(emptyFilterGroup()).children).toEqual([]);
  });
});

describe('capability matrix', () => {
  it('offers no sub-grouping on a board', () => {
    expect(capabilityFor('team', 'board').subGrouping).toBe(false);
    expect(capabilityFor('team', 'list').subGrouping).toBe(true);
  });

  it('drops the project dimension on a project page', () => {
    expect(capabilityFor('project', 'list').filters).not.toContain('project');
    expect(capabilityFor('project', 'list').groupBy).not.toContain('project');
    expect(capabilityFor('team', 'list').filters).toContain('project');
  });

  it('drops illegal parameters when the layout switches', () => {
    const config = {
      filter: group(inCondition('project', ['project-1']), inCondition('state', ['state-1'])),
      groupBy: 'none' as const,
      subGroupBy: 'assignee' as const,
      orderBy: 'manual' as const,
      display: defaultDisplayOptions('list'),
    };
    const boarded = sanitizeViewConfig(config, 'project', 'board');
    expect(conditionsOf(boarded.filter).map((entry) => entry.property)).toEqual(['state']);
    expect(boarded.groupBy).not.toBe('none');
    expect(boarded.subGroupBy).toBe('none');
  });

  it('refuses to sub-group by the grouping key', () => {
    const config = {
      filter: emptyFilterGroup(),
      groupBy: 'assignee' as const,
      subGroupBy: 'assignee' as const,
      orderBy: 'manual' as const,
      display: defaultDisplayOptions('list'),
    };
    expect(sanitizeViewConfig(config, 'team', 'list').subGroupBy).toBe('none');
  });
});

describe('view state', () => {
  it('fills in every field a view carries', () => {
    const state = defaultViewState('board');
    expect(state.layout).toBe('board');
    expect(state.visibility).toBe('private');
    expect(state.locked).toBe(false);
    expect(state.display.properties.length).toBeGreaterThan(0);
  });

  it('survives a view saved before a field existed', () => {
    expect(viewStateFrom({ groupBy: 'label' }).groupBy).toBe('label');
    expect(viewStateFrom(undefined)).toEqual(defaultViewState('list'));
  });

  it('round trips through the schema', () => {
    const state = viewStateSchema.parse({
      filter: tree,
      groupBy: 'assignee',
      visibility: 'workspace',
      locked: true,
    });
    expect(state.visibility).toBe('workspace');
    expect(conditionsOf(state.filter)).toEqual(conditions);
  });
});

describe('virtual views', () => {
  it('names four built-in views', () => {
    expect(VIRTUAL_VIEW_IDS).toHaveLength(4);
    for (const id of VIRTUAL_VIEW_IDS) expect(isVirtualViewId(id)).toBe(true);
    expect(isVirtualViewId('anything-else')).toBe(false);
  });

  it('builds each one from the viewer id rather than a stored row', () => {
    expect(conditionsOf(virtualViewState('virtual:all', 'user-1').filter)).toEqual([]);
    expect(conditionsOf(virtualViewState('virtual:assigned', 'user-1').filter)).toEqual([
      inCondition('assignee', ['user-1']),
    ]);
    expect(conditionsOf(virtualViewState('virtual:created', 'user-9').filter)).toEqual([
      inCondition('creator', ['user-9']),
    ]);
    expect(conditionsOf(virtualViewState('virtual:subscribed', 'user-9').filter)).toEqual([
      inCondition('subscriber', ['user-9']),
    ]);
  });
});

describe('save changes gating', () => {
  it('is clean straight after loading a saved view', () => {
    const saved = viewStateSchema.parse({ filter: tree, groupBy: 'assignee' });
    expect(viewStateDirty(saved, saved)).toBe(false);
  });

  it('notices a changed filter, grouping, ordering or display option', () => {
    const saved = viewStateSchema.parse({ filter: tree, groupBy: 'assignee' });
    expect(viewStateDirty({ ...saved, groupBy: 'label' }, saved)).toBe(true);
    expect(viewStateDirty({ ...saved, orderBy: 'due' }, saved)).toBe(true);
    expect(viewStateDirty({ ...saved, subGroupBy: 'label' }, saved)).toBe(true);
    expect(
      viewStateDirty({ ...saved, filter: removeCondition(saved.filter, 'state') }, saved),
    ).toBe(true);
    expect(
      viewStateDirty({ ...saved, display: { ...saved.display, showCompleted: 'week' } }, saved),
    ).toBe(true);
  });

  it('ignores a reordered property list and the fields that are not part of the view', () => {
    const saved = viewStateSchema.parse({ filter: tree });
    const reordered = {
      ...saved,
      display: { ...saved.display, properties: [...saved.display.properties].reverse() },
      position: 7,
      visibility: 'workspace' as const,
    };
    expect(viewStateDirty(reordered, saved)).toBe(false);
  });
});
