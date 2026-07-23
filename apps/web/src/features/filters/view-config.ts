import type { FilterPredicate, GroupByField, IssueOrdering } from '@orbit/shared/filters';
import {
  decodeFilterPredicates,
  encodeFilterPredicates,
  GROUP_BY_FIELDS,
  ISSUE_ORDERINGS,
} from '@orbit/shared/filters';

export type { IssueOrdering };
export { ISSUE_ORDERINGS };

export const ISSUE_ORDERING_LABELS: Record<IssueOrdering, string> = {
  manual: 'Manual',
  priority: 'Priority',
  created: 'Created',
  updated: 'Updated',
  due: 'Due date',
};

export const GROUP_BY_LABELS: Record<GroupByField, string> = {
  state: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  project: 'Project',
  label: 'Label',
  cycle: 'Cycle',
  none: 'No grouping',
};

export const ISSUE_PROPERTIES = [
  'priority',
  'identifier',
  'status',
  'labels',
  'estimate',
  'assignee',
] as const;

export type IssueProperty = (typeof ISSUE_PROPERTIES)[number];

export const ISSUE_PROPERTY_LABELS: Record<IssueProperty, string> = {
  priority: 'Priority',
  identifier: 'ID',
  status: 'Status',
  labels: 'Labels',
  estimate: 'Estimate',
  assignee: 'Assignee',
};

export type ViewLayoutMode = 'list' | 'board';

export interface ViewConfig {
  readonly predicates: readonly FilterPredicate[];
  readonly groupBy: GroupByField;
  readonly orderBy: IssueOrdering;
  readonly showSubIssues: boolean;
  readonly showEmptyGroups: boolean;
  readonly properties: readonly IssueProperty[];
}

export const FILTER_PARAM = 'filter';
export const GROUP_PARAM = 'group';
export const ORDER_PARAM = 'order';
export const SUB_ISSUES_PARAM = 'sub';
export const EMPTY_GROUPS_PARAM = 'empty';
export const PROPERTIES_PARAM = 'props';

export function defaultViewConfig(layout: ViewLayoutMode): ViewConfig {
  return {
    predicates: [],
    groupBy: 'state',
    orderBy: 'manual',
    showSubIssues: true,
    showEmptyGroups: layout === 'board',
    properties: [...ISSUE_PROPERTIES],
  };
}

function oneOf<T extends string>(candidate: string | null, allowed: readonly T[], fallback: T): T {
  const match = allowed.find((entry) => entry === candidate);
  return match ?? fallback;
}

function parseBoolean(candidate: string | null, fallback: boolean): boolean {
  if (candidate === '1' || candidate === 'true') return true;
  if (candidate === '0' || candidate === 'false') return false;
  return fallback;
}

function parseProperties(candidate: string | null): readonly IssueProperty[] | null {
  if (candidate === null) return null;
  if (candidate.trim().length === 0) return [];
  const chosen = candidate
    .split(',')
    .flatMap((entry) => ISSUE_PROPERTIES.filter((property) => property === entry.trim()));
  return [...new Set(chosen)];
}

export function parseViewConfig(
  params: URLSearchParams,
  layout: ViewLayoutMode,
  base: ViewConfig = defaultViewConfig(layout),
): ViewConfig {
  const raw = params.get(FILTER_PARAM);
  return {
    predicates: raw === null ? base.predicates : decodeFilterPredicates(raw),
    groupBy: oneOf(params.get(GROUP_PARAM), GROUP_BY_FIELDS, base.groupBy),
    orderBy: oneOf(params.get(ORDER_PARAM), ISSUE_ORDERINGS, base.orderBy),
    showSubIssues: parseBoolean(params.get(SUB_ISSUES_PARAM), base.showSubIssues),
    showEmptyGroups: parseBoolean(params.get(EMPTY_GROUPS_PARAM), base.showEmptyGroups),
    properties: parseProperties(params.get(PROPERTIES_PARAM)) ?? base.properties,
  };
}

function sameProperties(left: readonly IssueProperty[], right: readonly IssueProperty[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function viewConfigToParams(config: ViewConfig, layout: ViewLayoutMode): URLSearchParams {
  const fallback = defaultViewConfig(layout);
  const params = new URLSearchParams();
  if (config.predicates.length > 0) {
    params.set(FILTER_PARAM, encodeFilterPredicates(config.predicates));
  }
  if (config.groupBy !== fallback.groupBy) params.set(GROUP_PARAM, config.groupBy);
  if (config.orderBy !== fallback.orderBy) params.set(ORDER_PARAM, config.orderBy);
  if (config.showSubIssues !== fallback.showSubIssues) {
    params.set(SUB_ISSUES_PARAM, config.showSubIssues ? '1' : '0');
  }
  if (config.showEmptyGroups !== fallback.showEmptyGroups) {
    params.set(EMPTY_GROUPS_PARAM, config.showEmptyGroups ? '1' : '0');
  }
  if (!sameProperties(config.properties, fallback.properties)) {
    params.set(PROPERTIES_PARAM, config.properties.join(','));
  }
  return params;
}

export function viewConfigSearch(config: ViewConfig, layout: ViewLayoutMode): string {
  const query = viewConfigToParams(config, layout).toString();
  return query.length === 0 ? '' : `?${query}`;
}

export interface StoredViewFilter {
  readonly predicates?: readonly FilterPredicate[] | undefined;
  readonly orderBy?: IssueOrdering | undefined;
  readonly includeSubIssues?: boolean | undefined;
}

export function viewConfigToFilter(config: ViewConfig): StoredViewFilter {
  return {
    predicates: config.predicates,
    orderBy: config.orderBy,
    includeSubIssues: config.showSubIssues,
  };
}

export function viewConfigFromStored(
  filter: StoredViewFilter,
  groupBy: GroupByField,
  layout: ViewLayoutMode,
): ViewConfig {
  const fallback = defaultViewConfig(layout);
  return {
    ...fallback,
    predicates: filter.predicates ?? [],
    groupBy,
    orderBy: filter.orderBy ?? fallback.orderBy,
    showSubIssues: filter.includeSubIssues ?? fallback.showSubIssues,
  };
}
