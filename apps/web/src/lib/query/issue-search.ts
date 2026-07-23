import type { FilterPredicate, IssueOrdering } from '@orbit/shared/filters';
import { encodeFilterPredicates } from '@orbit/shared/filters';

export interface IssueQuery {
  readonly predicates: readonly FilterPredicate[];
  readonly orderBy: IssueOrdering;
  readonly includeSubIssues: boolean;
}

export const DEFAULT_ISSUE_QUERY: IssueQuery = {
  predicates: [],
  orderBy: 'manual',
  includeSubIssues: true,
};

export const ISSUE_PAGE_SIZE = 100;

function searchParams(query: IssueQuery): URLSearchParams {
  const params = new URLSearchParams({ limit: String(ISSUE_PAGE_SIZE), orderBy: query.orderBy });
  if (!query.includeSubIssues) params.set('includeSubIssues', 'false');
  const predicates = encodeFilterPredicates(query.predicates);
  if (predicates.length > 0) params.set('predicates', predicates);
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
