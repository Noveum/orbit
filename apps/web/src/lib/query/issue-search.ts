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

export function assignedSearch(userId: string): string {
  const params = searchParams({ ...DEFAULT_ISSUE_QUERY, orderBy: 'updated' });
  params.set('assigneeId', userId);
  return params.toString();
}
