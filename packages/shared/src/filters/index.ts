import { z } from 'zod';

export const FILTER_PROPERTIES = [
  'state',
  'assignee',
  'creator',
  'subscriber',
  'priority',
  'estimate',
  'label',
  'project',
  'cycle',
  'milestone',
  'relation',
  'link',
  'content',
  'due',
  'created',
  'updated',
  'started',
  'completed',
  'stateAge',
] as const;

export type FilterProperty = (typeof FILTER_PROPERTIES)[number];

export const FILTER_OPERATORS = ['exact', 'in', 'range', 'relative'] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const DATE_PROPERTIES = [
  'due',
  'created',
  'updated',
  'started',
  'completed',
  'stateAge',
] as const;

export type DateProperty = (typeof DATE_PROPERTIES)[number];

export function isDateProperty(property: FilterProperty): property is DateProperty {
  return DATE_PROPERTIES.some((entry) => entry === property);
}

const SET_OPERATORS: readonly FilterOperator[] = ['in'];
const DATE_OPERATORS: readonly FilterOperator[] = ['in', 'range', 'relative'];
const TEXT_OPERATORS: readonly FilterOperator[] = ['exact'];
const NUMERIC_OPERATORS: readonly FilterOperator[] = ['in', 'range'];

export const FILTER_PROPERTY_OPERATORS: Record<FilterProperty, readonly FilterOperator[]> = {
  state: SET_OPERATORS,
  assignee: SET_OPERATORS,
  creator: SET_OPERATORS,
  subscriber: SET_OPERATORS,
  priority: NUMERIC_OPERATORS,
  estimate: NUMERIC_OPERATORS,
  label: SET_OPERATORS,
  project: SET_OPERATORS,
  cycle: SET_OPERATORS,
  milestone: SET_OPERATORS,
  relation: SET_OPERATORS,
  link: SET_OPERATORS,
  content: TEXT_OPERATORS,
  due: DATE_OPERATORS,
  created: DATE_OPERATORS,
  updated: DATE_OPERATORS,
  started: DATE_OPERATORS,
  completed: DATE_OPERATORS,
  stateAge: DATE_OPERATORS,
};

export function supportsOperator(property: FilterProperty, operator: FilterOperator): boolean {
  return FILTER_PROPERTY_OPERATORS[property].includes(operator);
}

export const FILTER_PROPERTY_LABELS: Record<FilterProperty, string> = {
  state: 'Status',
  assignee: 'Assignee',
  creator: 'Creator',
  subscriber: 'Subscribers',
  priority: 'Priority',
  estimate: 'Estimate',
  label: 'Labels',
  project: 'Project',
  cycle: 'Cycle',
  milestone: 'Milestone',
  relation: 'Relations',
  link: 'Links',
  content: 'Content',
  due: 'Due date',
  created: 'Created date',
  updated: 'Updated date',
  started: 'Started date',
  completed: 'Completed date',
  stateAge: 'Time in current status',
};

export const FILTER_PROPERTY_GROUPS: readonly {
  readonly heading: string;
  readonly properties: readonly FilterProperty[];
}[] = [
  {
    heading: 'Issue',
    properties: ['state', 'assignee', 'creator', 'priority', 'estimate', 'label'],
  },
  { heading: 'Planning', properties: ['project', 'cycle', 'milestone'] },
  { heading: 'Dates', properties: [...DATE_PROPERTIES] },
  { heading: 'Other', properties: ['relation', 'link', 'subscriber', 'content'] },
];

export const UNSET_FILTER_VALUE = 'none';
export const ANY_FILTER_VALUE = 'any';

export const RELATION_FILTER_VALUES = [
  'parent',
  'sub_issue',
  'blocked',
  'blocking',
  'related',
  'duplicate',
  'none',
] as const;

export type RelationFilterValue = (typeof RELATION_FILTER_VALUES)[number];

export const RELATION_FILTER_LABELS: Record<RelationFilterValue, string> = {
  parent: 'Parent issues',
  sub_issue: 'Sub-issues',
  blocked: 'Blocked issues',
  blocking: 'Blocking issues',
  related: 'Issues with relations',
  duplicate: 'Duplicates',
  none: 'No relations',
};

export const LINK_FILTER_VALUES = ['any', 'none'] as const;
export type LinkFilterValue = (typeof LINK_FILTER_VALUES)[number];

export const LINK_FILTER_LABELS: Record<LinkFilterValue, string> = {
  any: 'Has attachments',
  none: 'No attachments',
};

export const MILESTONE_FILTER_VALUES = ['any', 'none'] as const;

export const RELATIVE_UNITS = ['day', 'week', 'month'] as const;
export type RelativeUnit = (typeof RELATIVE_UNITS)[number];

export const RELATIVE_DIRECTIONS = ['past', 'future'] as const;
export type RelativeDirection = (typeof RELATIVE_DIRECTIONS)[number];

export const MAX_RELATIVE_OFFSET = 520;

const tokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9_:-]+$/,
    'Filter values may only contain letters, digits, dashes, colons and underscores.',
  );

const textSchema = z.string().trim().min(1).max(200);

export const relativeDateSchema = z.object({
  unit: z.enum(RELATIVE_UNITS),
  offset: z.number().int().min(0).max(MAX_RELATIVE_OFFSET),
  direction: z.enum(RELATIVE_DIRECTIONS),
});

export type RelativeDate = z.infer<typeof relativeDateSchema>;

const conditionBase = {
  kind: z.literal('condition'),
  property: z.enum(FILTER_PROPERTIES),
  negate: z.boolean().default(false),
};

const filterConditionSchema = z
  .discriminatedUnion('operator', [
    z.object({ ...conditionBase, operator: z.literal('exact'), value: textSchema }),
    z.object({
      ...conditionBase,
      operator: z.literal('in'),
      values: z.array(tokenSchema).min(1).max(50),
    }),
    z.object({
      ...conditionBase,
      operator: z.literal('range'),
      from: tokenSchema.nullable().default(null),
      to: tokenSchema.nullable().default(null),
    }),
    z.object({ ...conditionBase, operator: z.literal('relative'), relative: relativeDateSchema }),
  ])
  .refine(
    (condition) => supportsOperator(condition.property, condition.operator),
    'That filter does not support that operator.',
  )
  .refine(
    (condition) =>
      condition.operator !== 'range' || condition.from !== null || condition.to !== null,
    'A range filter needs at least one bound.',
  );

export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const FILTER_COMBINATORS = ['and', 'or'] as const;
export type FilterCombinator = (typeof FILTER_COMBINATORS)[number];

export const MAX_FILTER_DEPTH = 5;
export const MAX_FILTER_CONDITIONS = 50;

export interface FilterGroup {
  readonly kind: 'group';
  readonly combinator: FilterCombinator;
  readonly children: readonly FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

function nodeSchemaAtDepth(depth: number): z.ZodType<FilterNode, unknown> {
  if (depth >= MAX_FILTER_DEPTH) return filterConditionSchema;
  const child = nodeSchemaAtDepth(depth + 1);
  return z.union([
    filterConditionSchema,
    z.object({
      kind: z.literal('group'),
      combinator: z.enum(FILTER_COMBINATORS).default('and'),
      children: z.array(child).max(MAX_FILTER_CONDITIONS),
    }),
  ]);
}

export function countConditions(node: FilterNode): number {
  if (node.kind === 'condition') return 1;
  return node.children.reduce((total, child) => total + countConditions(child), 0);
}

export const filterGroupSchema: z.ZodType<FilterGroup, unknown> = z
  .object({
    kind: z.literal('group'),
    combinator: z.enum(FILTER_COMBINATORS).default('and'),
    children: z.array(nodeSchemaAtDepth(2)).max(MAX_FILTER_CONDITIONS),
  })
  .refine(
    (group) => countConditions(group) <= MAX_FILTER_CONDITIONS,
    `A filter may hold at most ${MAX_FILTER_CONDITIONS} conditions.`,
  );

export function emptyFilterGroup(): FilterGroup {
  return { kind: 'group', combinator: 'and', children: [] };
}

export function isEmptyFilter(group: FilterGroup): boolean {
  return countConditions(group) === 0;
}

export function encodeFilter(group: FilterGroup): string {
  return isEmptyFilter(group) ? '' : JSON.stringify(group);
}

export function decodeFilter(raw: string): FilterGroup {
  if (raw.trim().length === 0) return emptyFilterGroup();
  try {
    const parsed = filterGroupSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyFilterGroup();
  } catch {
    return emptyFilterGroup();
  }
}

export const filterGroupQuerySchema = z
  .preprocess(
    (value) => (typeof value === 'string' ? decodeFilter(value) : value),
    filterGroupSchema,
  )
  .default(emptyFilterGroup());

export function conditionsOf(group: FilterGroup): FilterCondition[] {
  return group.children.flatMap((child) =>
    child.kind === 'condition' ? [child] : conditionsOf(child),
  );
}

export function conditionFor(
  group: FilterGroup,
  property: FilterProperty,
): FilterCondition | undefined {
  return group.children.find(
    (child): child is FilterCondition => child.kind === 'condition' && child.property === property,
  );
}

export function replaceCondition(group: FilterGroup, next: FilterCondition): FilterGroup {
  const index = group.children.findIndex(
    (child) => child.kind === 'condition' && child.property === next.property,
  );
  if (index === -1) return { ...group, children: [...group.children, next] };
  const children = [...group.children];
  children[index] = next;
  return { ...group, children };
}

export function removeCondition(group: FilterGroup, property: FilterProperty): FilterGroup {
  return {
    ...group,
    children: group.children.filter(
      (child) => !(child.kind === 'condition' && child.property === property),
    ),
  };
}

export function dropLastCondition(group: FilterGroup): FilterGroup {
  return { ...group, children: group.children.slice(0, -1) };
}

export function conditionValues(condition: FilterCondition): readonly string[] {
  return condition.operator === 'in' ? condition.values : [];
}

export function inCondition(
  property: FilterProperty,
  values: readonly string[],
  negate = false,
): FilterCondition {
  return { kind: 'condition', property, operator: 'in', values: [...values], negate };
}

export const GROUP_BY_FIELDS = [
  'state',
  'assignee',
  'priority',
  'project',
  'label',
  'cycle',
  'creator',
  'estimate',
  'none',
] as const;

export type GroupByField = (typeof GROUP_BY_FIELDS)[number];

export const GROUP_BY_LABELS: Record<GroupByField, string> = {
  state: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  project: 'Project',
  label: 'Label',
  cycle: 'Cycle',
  creator: 'Creator',
  estimate: 'Estimate',
  none: 'No grouping',
};

export const VIEW_LAYOUTS = ['list', 'board', 'table', 'calendar', 'timeline'] as const;

export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export const ISSUE_ORDERINGS = [
  'manual',
  'priority',
  'created',
  'updated',
  'due',
  'estimate',
  'title',
] as const;

export type IssueOrdering = (typeof ISSUE_ORDERINGS)[number];

export const ISSUE_ORDERING_LABELS: Record<IssueOrdering, string> = {
  manual: 'Manual',
  priority: 'Priority',
  created: 'Created',
  updated: 'Updated',
  due: 'Due date',
  estimate: 'Estimate',
  title: 'Title',
};

export const DISPLAY_PROPERTIES = [
  'priority',
  'identifier',
  'status',
  'labels',
  'estimate',
  'assignee',
  'creator',
  'project',
  'cycle',
  'milestone',
  'dueDate',
  'created',
  'updated',
  'started',
  'completed',
  'subIssues',
] as const;

export type DisplayProperty = (typeof DISPLAY_PROPERTIES)[number];

export const DISPLAY_PROPERTY_LABELS: Record<DisplayProperty, string> = {
  priority: 'Priority',
  identifier: 'ID',
  status: 'Status',
  labels: 'Labels',
  estimate: 'Estimate',
  assignee: 'Assignee',
  creator: 'Creator',
  project: 'Project',
  cycle: 'Cycle',
  milestone: 'Milestone',
  dueDate: 'Due date',
  created: 'Created',
  updated: 'Updated',
  started: 'Started',
  completed: 'Completed',
  subIssues: 'Sub-issue count',
};

export const COMPLETED_WINDOWS = ['all', 'month', 'week', 'none'] as const;
export type CompletedWindow = (typeof COMPLETED_WINDOWS)[number];

export const COMPLETED_WINDOW_LABELS: Record<CompletedWindow, string> = {
  all: 'All completed issues',
  month: 'Completed in the past month',
  week: 'Completed in the past week',
  none: 'No completed issues',
};

export const displayOptionsSchema = z.object({
  showSubIssues: z.boolean().default(true),
  showEmptyGroups: z.boolean().default(false),
  showCompleted: z.enum(COMPLETED_WINDOWS).default('all'),
  properties: z.array(z.enum(DISPLAY_PROPERTIES)).default([...DISPLAY_PROPERTIES]),
});

export type DisplayOptions = z.infer<typeof displayOptionsSchema>;

export const DEFAULT_DISPLAY_PROPERTIES: readonly DisplayProperty[] = [
  'priority',
  'identifier',
  'status',
  'labels',
  'estimate',
  'assignee',
];

export function defaultDisplayOptions(layout: ViewLayout): DisplayOptions {
  return {
    showSubIssues: true,
    showEmptyGroups: layout === 'board',
    showCompleted: 'all',
    properties: [...DEFAULT_DISPLAY_PROPERTIES],
  };
}

export function daysInUnit(unit: RelativeUnit): number {
  if (unit === 'day') return 1;
  if (unit === 'week') return 7;
  return 30;
}

function shiftIsoDay(day: string, days: number): string {
  const base = new Date(`${day}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export function resolveRelativeRange(relative: RelativeDate, today: string): DateRange {
  const span = daysInUnit(relative.unit) * relative.offset;
  if (relative.direction === 'future') return { from: today, to: shiftIsoDay(today, span) };
  return { from: shiftIsoDay(today, -span), to: today };
}

export function describeRelative(relative: RelativeDate): string {
  const unit = relative.offset === 1 ? relative.unit : `${relative.unit}s`;
  if (relative.direction === 'future') return `in the next ${relative.offset} ${unit}`;
  return `in the past ${relative.offset} ${unit}`;
}

export const VIEW_PAGES = ['team', 'my_issues', 'project', 'cycle', 'saved_view'] as const;
export type ViewPage = (typeof VIEW_PAGES)[number];

export const VIEW_LAYOUT_MODES = ['list', 'board'] as const;
export type ViewLayoutMode = (typeof VIEW_LAYOUT_MODES)[number];

export interface ViewCapability {
  readonly filters: readonly FilterProperty[];
  readonly groupBy: readonly GroupByField[];
  readonly subGroupBy: readonly GroupByField[];
  readonly orderBy: readonly IssueOrdering[];
  readonly properties: readonly DisplayProperty[];
  readonly showEmptyGroups: boolean;
  readonly subGrouping: boolean;
}

const BOARD_GROUP_BY: readonly GroupByField[] = GROUP_BY_FIELDS.filter((field) => field !== 'none');
const BOARD_ORDER_BY: readonly IssueOrdering[] = ISSUE_ORDERINGS;
const LIST_ORDER_BY: readonly IssueOrdering[] = ISSUE_ORDERINGS;

function base(layout: ViewLayoutMode): ViewCapability {
  return {
    filters: FILTER_PROPERTIES,
    groupBy: layout === 'board' ? BOARD_GROUP_BY : GROUP_BY_FIELDS,
    subGroupBy: layout === 'board' ? ['none'] : GROUP_BY_FIELDS,
    orderBy: layout === 'board' ? BOARD_ORDER_BY : LIST_ORDER_BY,
    properties: DISPLAY_PROPERTIES,
    showEmptyGroups: true,
    subGrouping: layout === 'list',
  };
}

function without(
  capability: ViewCapability,
  drop: { filters?: readonly FilterProperty[]; grouping?: readonly GroupByField[] },
): ViewCapability {
  const filters = drop.filters ?? [];
  const grouping = drop.grouping ?? [];
  return {
    ...capability,
    filters: capability.filters.filter((entry) => !filters.includes(entry)),
    groupBy: capability.groupBy.filter((entry) => !grouping.includes(entry)),
    subGroupBy: capability.subGroupBy.filter((entry) => !grouping.includes(entry)),
  };
}

function matrixFor(page: ViewPage): Record<ViewLayoutMode, ViewCapability> {
  const build = (layout: ViewLayoutMode): ViewCapability => {
    const capability = base(layout);
    if (page === 'project') {
      return without(capability, { filters: ['project'], grouping: ['project'] });
    }
    if (page === 'cycle') return without(capability, { filters: ['cycle'], grouping: ['cycle'] });
    if (page === 'my_issues') {
      return without(capability, { filters: ['assignee'], grouping: ['assignee'] });
    }
    return capability;
  };
  return { list: build('list'), board: build('board') };
}

export const VIEW_CAPABILITIES: Record<ViewPage, Record<ViewLayoutMode, ViewCapability>> = {
  team: matrixFor('team'),
  my_issues: matrixFor('my_issues'),
  project: matrixFor('project'),
  cycle: matrixFor('cycle'),
  saved_view: matrixFor('saved_view'),
};

export function capabilityFor(page: ViewPage, layout: ViewLayoutMode): ViewCapability {
  return VIEW_CAPABILITIES[page][layout];
}

export interface ViewConfig {
  readonly filter: FilterGroup;
  readonly groupBy: GroupByField;
  readonly subGroupBy: GroupByField;
  readonly orderBy: IssueOrdering;
  readonly display: DisplayOptions;
}

export const viewConfigSchema = z.object({
  filter: filterGroupQuerySchema,
  groupBy: z.enum(GROUP_BY_FIELDS).default('state'),
  subGroupBy: z.enum(GROUP_BY_FIELDS).default('none'),
  orderBy: z.enum(ISSUE_ORDERINGS).default('manual'),
  display: displayOptionsSchema.default(displayOptionsSchema.parse({})),
});

function pruneNode(node: FilterNode, allowed: readonly FilterProperty[]): FilterNode | null {
  if (node.kind === 'condition') return allowed.includes(node.property) ? node : null;
  const children = node.children.flatMap((child) => {
    const kept = pruneNode(child, allowed);
    return kept === null ? [] : [kept];
  });
  return { ...node, children };
}

export function pruneFilter(group: FilterGroup, allowed: readonly FilterProperty[]): FilterGroup {
  const pruned = pruneNode(group, allowed);
  return pruned === null || pruned.kind === 'condition' ? { ...group, children: [] } : pruned;
}

function pick<T>(candidate: T, allowed: readonly T[], fallback: T): T {
  return allowed.includes(candidate) ? candidate : fallback;
}

export function sanitizeViewConfig(
  config: ViewConfig,
  page: ViewPage,
  layout: ViewLayoutMode,
): ViewConfig {
  const capability = capabilityFor(page, layout);
  const groupBy = pick(config.groupBy, capability.groupBy, capability.groupBy[0] ?? 'state');
  const requested = capability.subGrouping ? config.subGroupBy : 'none';
  const subGroupBy =
    requested === groupBy ? 'none' : pick(requested, capability.subGroupBy, 'none');
  return {
    filter: pruneFilter(config.filter, capability.filters),
    groupBy,
    subGroupBy,
    orderBy: pick(config.orderBy, capability.orderBy, 'manual'),
    display: {
      ...config.display,
      showEmptyGroups: capability.showEmptyGroups ? config.display.showEmptyGroups : false,
      properties: config.display.properties.filter((entry) =>
        capability.properties.includes(entry),
      ),
    },
  };
}

export const VIEW_VISIBILITIES = ['private', 'team', 'workspace'] as const;
export type ViewVisibility = (typeof VIEW_VISIBILITIES)[number];

export const VIEW_VISIBILITY_LABELS: Record<ViewVisibility, string> = {
  private: 'Only me',
  team: 'My teams',
  workspace: 'Everyone in the workspace',
};

const optionalId = z.string().trim().max(64).nullable().default(null);

export const viewStateSchema = z.object({
  filter: filterGroupQuerySchema,
  groupBy: z.enum(GROUP_BY_FIELDS).default('state'),
  subGroupBy: z.enum(GROUP_BY_FIELDS).default('none'),
  orderBy: z.enum(ISSUE_ORDERINGS).default('manual'),
  display: displayOptionsSchema.default(displayOptionsSchema.parse({})),
  layout: z.enum(VIEW_LAYOUT_MODES).default('list'),
  teamId: optionalId,
  projectId: optionalId,
  visibility: z.enum(VIEW_VISIBILITIES).default('private'),
  locked: z.boolean().default(false),
  position: z.number().int().min(0).max(100_000).default(0),
});

export type ViewState = z.infer<typeof viewStateSchema>;

export function defaultViewState(layout: ViewLayoutMode = 'list'): ViewState {
  return viewStateSchema.parse({ layout, display: defaultDisplayOptions(layout) });
}

export function viewStateFrom(raw: unknown, layout: ViewLayoutMode = 'list'): ViewState {
  const parsed = viewStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultViewState(layout);
}

export const VIRTUAL_VIEW_IDS = [
  'virtual:all',
  'virtual:assigned',
  'virtual:created',
  'virtual:subscribed',
] as const;

export type VirtualViewId = (typeof VIRTUAL_VIEW_IDS)[number];

export function isVirtualViewId(id: string): id is VirtualViewId {
  return VIRTUAL_VIEW_IDS.some((entry) => entry === id);
}

export const VIRTUAL_VIEW_NAMES: Record<VirtualViewId, string> = {
  'virtual:all': 'All issues',
  'virtual:assigned': 'Assigned to me',
  'virtual:created': 'Created by me',
  'virtual:subscribed': 'Subscribed',
};

const VIRTUAL_VIEW_PROPERTIES: Record<VirtualViewId, FilterProperty> = {
  'virtual:all': 'state',
  'virtual:assigned': 'assignee',
  'virtual:created': 'creator',
  'virtual:subscribed': 'subscriber',
};

export function virtualViewState(id: VirtualViewId, userId: string): ViewState {
  const base = defaultViewState('list');
  if (id === 'virtual:all') return base;
  const property = VIRTUAL_VIEW_PROPERTIES[id];
  return {
    ...base,
    filter: { kind: 'group', combinator: 'and', children: [inCondition(property, [userId])] },
  };
}

function comparableViewState(state: ViewState) {
  return {
    filter: state.filter,
    groupBy: state.groupBy,
    subGroupBy: state.subGroupBy,
    orderBy: state.orderBy,
    display: { ...state.display, properties: [...state.display.properties].sort() },
    layout: state.layout,
  };
}

export function viewStateDirty(current: ViewState, saved: ViewState): boolean {
  return (
    JSON.stringify(comparableViewState(current)) !== JSON.stringify(comparableViewState(saved))
  );
}
