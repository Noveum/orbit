import type { FilterGroup, IssueOrdering } from '@orbit/shared/filters';
import { emptyFilterGroup, encodeFilter } from '@orbit/shared/filters';

export interface IssueQuery {
  readonly filter: FilterGroup;
  readonly orderBy: IssueOrdering;
}

export const DEFAULT_ISSUE_QUERY: IssueQuery = {
  filter: emptyFilterGroup(),
  orderBy: 'manual',
};

export const ISSUE_PAGE_SIZE = 100;

function searchParams(query: IssueQuery): URLSearchParams {
  const params = new URLSearchParams({ limit: String(ISSUE_PAGE_SIZE), orderBy: query.orderBy });
  const filter = encodeFilter(query.filter);
  if (filter.length > 0) params.set('filter', filter);
  return params;
}

export function issueSearch(teamId: string, query: IssueQuery): string {
  const params = searchParams(query);
  params.set('teamId', teamId);
  return params.toString();
}

export function columnSearch(teamId: string, query: IssueQuery, stateId: string): string {
  const params = searchParams(query);
  params.set('teamId', teamId);
  params.set('stateId', stateId);
  return params.toString();
}

export const UNGROUPED_COLUMN = 'none';

const GROUP_PARAM_OF: Readonly<Record<string, string>> = {
  state: 'stateId',
  assignee: 'assigneeId',
  project: 'projectId',
  cycle: 'cycleId',
};

export function columnParamFor(groupBy: string): string | null {
  return GROUP_PARAM_OF[groupBy] ?? null;
}

export function boardSearch(
  query: IssueQuery,
  groupBy: string,
  scope: Readonly<Record<string, string>> = {},
  perGroup?: number,
): string {
  const params = searchParams(query);
  params.delete('limit');
  for (const [key, value] of Object.entries(scope)) params.set(key, value);
  params.set('groupBy', groupBy);
  if (perGroup !== undefined) params.set('perGroup', String(perGroup));
  return params.toString();
}

export function groupColumnSearch(
  query: IssueQuery,
  groupBy: string,
  groupId: string,
  scope: Readonly<Record<string, string>> = {},
): string {
  const param = columnParamFor(groupBy);
  if (param === null || groupId === UNGROUPED_COLUMN) return '';
  if (Object.hasOwn(scope, param)) return '';
  const params = searchParams(query);
  for (const [key, value] of Object.entries(scope)) params.set(key, value);
  params.set(param, groupId);
  return params.toString();
}

export function summarySearch(
  teamId: string | null,
  query: IssueQuery,
  groupBy: string,
  scope: Readonly<Record<string, string>> = {},
): string {
  const params = searchParams(query);
  if (teamId !== null) params.set('teamId', teamId);
  for (const [key, value] of Object.entries(scope)) params.set(key, value);
  params.set('groupBy', groupBy);
  return params.toString();
}

export function facetsSearch(
  teamId: string | null,
  scope: Readonly<Record<string, string>> = {},
): string {
  const params = new URLSearchParams();
  if (teamId !== null) params.set('teamId', teamId);
  for (const [key, value] of Object.entries(scope)) params.set(key, value);
  return params.toString();
}

export function assignedSearch(userId: string, query?: IssueQuery): string {
  const params = searchParams(query ?? { ...DEFAULT_ISSUE_QUERY, orderBy: 'updated' });
  params.set('assigneeId', userId);
  return params.toString();
}

export const ALL_ISSUES_QUERY: IssueQuery = { ...DEFAULT_ISSUE_QUERY, orderBy: 'updated' };

export const EMPTY_ISSUE_SCOPE: Readonly<Record<string, string>> = {};

export function allIssuesSearch(
  query: IssueQuery = ALL_ISSUES_QUERY,
  scope: Readonly<Record<string, string>> = EMPTY_ISSUE_SCOPE,
): string {
  const params = searchParams(query);
  for (const [key, value] of Object.entries(scope)) params.set(key, value);
  return params.toString();
}

export function projectIssuesSearch(
  projectId: string,
  query: IssueQuery = { ...DEFAULT_ISSUE_QUERY, orderBy: 'updated' },
): string {
  const params = searchParams(query);
  params.set('projectId', projectId);
  return params.toString();
}
