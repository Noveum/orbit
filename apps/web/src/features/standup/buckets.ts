import { STATE_CATEGORIES, type StateCategory } from '@orbit/shared/constants';
import type { Issue, Member, StandupWorkload, WorkflowState } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';

export interface PersonBuckets {
  readonly closed: readonly Issue[];
  readonly inFlight: readonly Issue[];
  readonly upNext: readonly Issue[];
}

export interface RosterEntry {
  readonly member: Member;
  readonly issues: readonly Issue[];
  readonly total: number;
  readonly inFlight: number;
}

export interface StageGroup {
  readonly category: StateCategory;
  readonly title: string;
  readonly issues: readonly Issue[];
}

export const NO_ISSUES: readonly Issue[] = [];

export const STAGE_TITLES: Record<StateCategory, string> = {
  triage: 'Triage',
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In Progress',
  review: 'In Review',
  completed: 'Done',
  canceled: 'Canceled',
};

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

export function toStateCategory(value: string | undefined): StateCategory | null {
  const found = STATE_CATEGORIES.find((category) => category === value);
  return found ?? null;
}

export function stageGroups(
  issues: readonly Issue[],
  stateById: ReadonlyMap<string, WorkflowState>,
): readonly StageGroup[] {
  const byCategory = new Map<StateCategory, Issue[]>();
  for (const issue of issues) {
    const category = toStateCategory(stateById.get(issue.stateId)?.category);
    if (category === null) continue;
    const owned = byCategory.get(category);
    if (owned === undefined) byCategory.set(category, [issue]);
    else owned.push(issue);
  }

  return STATE_CATEGORIES.flatMap((category) => {
    const owned = byCategory.get(category);
    if (owned === undefined || owned.length === 0) return [];
    return [{ category, title: STAGE_TITLES[category], issues: sortIssues(owned) }];
  });
}

export function standupRoster(
  issues: readonly Issue[],
  members: readonly Member[],
  workload: readonly StandupWorkload[],
  stateById: ReadonlyMap<string, WorkflowState>,
): readonly RosterEntry[] {
  const owned = groupByAssignee(issues);
  const workloadById = new Map(workload.map((row) => [row.userId, row]));

  return [...members]
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((member) => {
      const theirs = owned.get(member.id) ?? NO_ISSUES;
      if (theirs.length === 0) return [];
      const buckets = bucketIssues(theirs, stateById);
      const shown = readingOrder(buckets);
      const counted = workloadById.get(member.id);
      const total = counted === undefined ? 0 : counted.open + counted.completedSince;
      return [
        {
          member,
          issues: shown,
          total: Math.max(total, shown.length),
          inFlight: buckets.inFlight.length,
        },
      ];
    });
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const held = shuffled[index];
    const other = shuffled[swap];
    if (held === undefined || other === undefined) continue;
    shuffled[index] = other;
    shuffled[swap] = held;
  }
  return shuffled;
}

export function orderRoster(
  roster: readonly RosterEntry[],
  order: readonly string[],
): readonly RosterEntry[] {
  if (order.length === 0) return roster;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...roster].sort((left, right) => {
    const leftRank = rank.get(left.member.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.member.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.member.name.localeCompare(right.member.name);
  });
}

export function nextSpeaker(
  roster: readonly RosterEntry[],
  currentId: string | null,
  spoken: ReadonlySet<string>,
): string | null {
  const ids = roster.map((entry) => entry.member.id);
  const from = currentId === null ? -1 : ids.indexOf(currentId);
  for (let step = 1; step <= ids.length; step++) {
    const candidate = ids[(from + step) % ids.length];
    if (candidate === undefined) continue;
    if (candidate === currentId) continue;
    if (!spoken.has(candidate)) return candidate;
  }
  return null;
}
