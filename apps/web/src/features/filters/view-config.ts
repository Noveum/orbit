import type {
  CompletedWindow,
  DisplayOptions,
  DisplayProperty,
  FilterGroup,
  GroupByField,
  IssueOrdering,
  ViewLayoutMode,
  ViewPage,
  ViewState,
} from '@orbit/shared/filters';
import {
  COMPLETED_WINDOWS,
  DISPLAY_PROPERTIES,
  decodeFilter,
  defaultDisplayOptions,
  encodeFilter,
  GROUP_BY_FIELDS,
  ISSUE_ORDERINGS,
  isEmptyFilter,
  sanitizeViewConfig,
  viewStateSchema,
} from '@orbit/shared/filters';

export type { ViewLayoutMode, ViewPage };

export interface ViewConfig {
  readonly filter: FilterGroup;
  readonly groupBy: GroupByField;
  readonly subGroupBy: GroupByField;
  readonly orderBy: IssueOrdering;
  readonly display: DisplayOptions;
}

export const FILTER_PARAM = 'filter';
export const GROUP_PARAM = 'group';
export const SUB_GROUP_PARAM = 'subgroup';
export const ORDER_PARAM = 'order';
export const SUB_ISSUES_PARAM = 'sub';
export const EMPTY_GROUPS_PARAM = 'empty';
export const COMPLETED_PARAM = 'done';
export const PROPERTIES_PARAM = 'props';

export function defaultViewConfig(layout: ViewLayoutMode): ViewConfig {
  return {
    filter: { kind: 'group', combinator: 'and', children: [] },
    groupBy: 'state',
    subGroupBy: 'none',
    orderBy: 'manual',
    display: defaultDisplayOptions(layout),
  };
}

function oneOf<T extends string>(candidate: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((entry) => entry === candidate) ?? fallback;
}

function parseBoolean(candidate: string | null, fallback: boolean): boolean {
  if (candidate === '1' || candidate === 'true') return true;
  if (candidate === '0' || candidate === 'false') return false;
  return fallback;
}

function parseProperties(candidate: string | null): readonly DisplayProperty[] | null {
  if (candidate === null) return null;
  if (candidate.trim().length === 0) return [];
  const chosen = candidate
    .split(',')
    .flatMap((entry) => DISPLAY_PROPERTIES.filter((property) => property === entry.trim()));
  return [...new Set(chosen)];
}

export function parseViewConfig(
  params: URLSearchParams,
  layout: ViewLayoutMode,
  base: ViewConfig = defaultViewConfig(layout),
): ViewConfig {
  const raw = params.get(FILTER_PARAM);
  return {
    filter: raw === null ? base.filter : decodeFilter(raw),
    groupBy: oneOf(params.get(GROUP_PARAM), GROUP_BY_FIELDS, base.groupBy),
    subGroupBy: oneOf(params.get(SUB_GROUP_PARAM), GROUP_BY_FIELDS, base.subGroupBy),
    orderBy: oneOf(params.get(ORDER_PARAM), ISSUE_ORDERINGS, base.orderBy),
    display: {
      showSubIssues: parseBoolean(params.get(SUB_ISSUES_PARAM), base.display.showSubIssues),
      showEmptyGroups: parseBoolean(params.get(EMPTY_GROUPS_PARAM), base.display.showEmptyGroups),
      showCompleted: oneOf(
        params.get(COMPLETED_PARAM),
        COMPLETED_WINDOWS,
        base.display.showCompleted,
      ),
      properties: [...(parseProperties(params.get(PROPERTIES_PARAM)) ?? base.display.properties)],
    },
  };
}

function sameProperties(
  left: readonly DisplayProperty[],
  right: readonly DisplayProperty[],
): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function viewConfigToParams(config: ViewConfig, layout: ViewLayoutMode): URLSearchParams {
  const fallback = defaultViewConfig(layout);
  const params = new URLSearchParams();
  if (!isEmptyFilter(config.filter)) params.set(FILTER_PARAM, encodeFilter(config.filter));
  if (config.groupBy !== fallback.groupBy) params.set(GROUP_PARAM, config.groupBy);
  if (config.subGroupBy !== fallback.subGroupBy) params.set(SUB_GROUP_PARAM, config.subGroupBy);
  if (config.orderBy !== fallback.orderBy) params.set(ORDER_PARAM, config.orderBy);
  if (config.display.showSubIssues !== fallback.display.showSubIssues) {
    params.set(SUB_ISSUES_PARAM, config.display.showSubIssues ? '1' : '0');
  }
  if (config.display.showEmptyGroups !== fallback.display.showEmptyGroups) {
    params.set(EMPTY_GROUPS_PARAM, config.display.showEmptyGroups ? '1' : '0');
  }
  if (config.display.showCompleted !== fallback.display.showCompleted) {
    params.set(COMPLETED_PARAM, config.display.showCompleted);
  }
  if (!sameProperties(config.display.properties, fallback.display.properties)) {
    params.set(PROPERTIES_PARAM, config.display.properties.join(','));
  }
  return params;
}

export function viewConfigSearch(config: ViewConfig, layout: ViewLayoutMode): string {
  const query = viewConfigToParams(config, layout).toString();
  return query.length === 0 ? '' : `?${query}`;
}

export function displayIsDefault(config: ViewConfig, layout: ViewLayoutMode): boolean {
  const fallback = defaultViewConfig(layout);
  return (
    config.groupBy === fallback.groupBy &&
    config.subGroupBy === fallback.subGroupBy &&
    config.orderBy === fallback.orderBy &&
    config.display.showSubIssues === fallback.display.showSubIssues &&
    config.display.showEmptyGroups === fallback.display.showEmptyGroups &&
    config.display.showCompleted === fallback.display.showCompleted &&
    sameProperties(config.display.properties, fallback.display.properties)
  );
}

export interface ViewScope {
  readonly teamId: string | null;
  readonly projectId: string | null;
}

export function viewConfigToState(
  config: ViewConfig,
  layout: ViewLayoutMode,
  scope: ViewScope,
  extra: { visibility?: ViewState['visibility']; locked?: boolean; position?: number } = {},
): ViewState {
  return viewStateSchema.parse({
    filter: config.filter,
    groupBy: config.groupBy,
    subGroupBy: config.subGroupBy,
    orderBy: config.orderBy,
    display: config.display,
    layout,
    teamId: scope.teamId,
    projectId: scope.projectId,
    visibility: extra.visibility ?? 'private',
    locked: extra.locked ?? false,
    position: extra.position ?? 0,
  });
}

export function viewConfigFromState(state: ViewState): ViewConfig {
  return {
    filter: state.filter,
    groupBy: state.groupBy,
    subGroupBy: state.subGroupBy,
    orderBy: state.orderBy,
    display: state.display,
  };
}

export function applyCapabilities(
  config: ViewConfig,
  page: ViewPage,
  layout: ViewLayoutMode,
): ViewConfig {
  return sanitizeViewConfig(config, page, layout);
}

export const COMPLETED_WINDOW_DAYS: Record<CompletedWindow, number | null> = {
  all: null,
  month: 30,
  week: 7,
  none: 0,
};
