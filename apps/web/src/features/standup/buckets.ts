import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';

export interface PersonBuckets {
  readonly closed: readonly Issue[];
  readonly inFlight: readonly Issue[];
  readonly upNext: readonly Issue[];
}

export const NO_ISSUES: readonly Issue[] = [];

export const NO_WORK: PersonBuckets = { closed: [], inFlight: [], upNext: [] };

export function groupByAssignee(issues: readonly Issue[]): ReadonlyMap<string, readonly Issue[]> {
  const byUser = new Map<string, Issue[]>();
  for (const issue of issues) {
    const assigneeId = issue.assigneeId;
    if (assigneeId === null) continue;
    const owned = byUser.get(assigneeId);
    if (owned === undefined) byUser.set(assigneeId, [issue]);
    else owned.push(issue);
  }
  return byUser;
}

export function bucketIssues(
  issues: readonly Issue[],
  stateById: ReadonlyMap<string, WorkflowState>,
): PersonBuckets {
  const closed: Issue[] = [];
  const inFlight: Issue[] = [];
  const upNext: Issue[] = [];

  for (const issue of issues) {
    const category = stateById.get(issue.stateId)?.category;
    if (category === 'completed' || category === 'canceled') closed.push(issue);
    else if (category === 'started' || category === 'review') inFlight.push(issue);
    else upNext.push(issue);
  }

  return { closed, inFlight, upNext: sortIssues(upNext) };
}

export function totalOf(buckets: PersonBuckets): number {
  return buckets.closed.length + buckets.inFlight.length + buckets.upNext.length;
}
