import type { Issue, Member, StandupWorkload, WorkflowState } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';

export interface PersonBuckets {
  readonly closed: readonly Issue[];
  readonly inFlight: readonly Issue[];
  readonly upNext: readonly Issue[];
}

export interface PersonColumn {
  readonly member: Member;
  readonly issues: readonly Issue[];
  readonly total: number;
}

export const NO_ISSUES: readonly Issue[] = [];

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

export function readingOrder(buckets: PersonBuckets): readonly Issue[] {
  return [...buckets.inFlight, ...buckets.upNext, ...buckets.closed];
}

export function personColumns(
  issues: readonly Issue[],
  members: readonly Member[],
  workload: readonly StandupWorkload[],
  stateById: ReadonlyMap<string, WorkflowState>,
): readonly PersonColumn[] {
  const owned = groupByAssignee(issues);
  const workloadById = new Map(workload.map((row) => [row.userId, row]));

  return [...members]
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((member) => {
      const theirs = owned.get(member.id) ?? NO_ISSUES;
      if (theirs.length === 0) return [];
      const shown = readingOrder(bucketIssues(theirs, stateById));
      const counted = workloadById.get(member.id);
      const total = counted === undefined ? 0 : counted.open + counted.completedSince;
      return [{ member, issues: shown, total: Math.max(total, shown.length) }];
    });
}
