import {
  activeCycle,
  type CycleProgress,
  cycleProgress,
  getCycleByNumber,
  pageOfCycles,
  pastCycles,
  type RecordedOutcome,
  sprintOutcome,
  sprintOutcomes,
  upcomingCycles,
} from '@orbit/core';
import { and, asc, count, db, eq, inArray, isNull, schema } from '@orbit/db';
import type { StateCategory } from '@orbit/shared/constants';
import { STATE_CATEGORIES, STATE_CATEGORY_ORDER } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { sprintLabel } from '@orbit/shared/utils';

export interface CycleIssueView {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly priority: number;
  readonly assignee: { id: string; name: string; image: string | null } | null;
}

export interface StateGroup {
  readonly stateId: string;
  readonly name: string;
  readonly category: StateCategory;
  readonly color: string;
  readonly issues: CycleIssueView[];
}

export interface AssigneeTally {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
  readonly points: number[];
  readonly issues: number[];
  readonly totalPoints: number;
  readonly totalIssues: number;
}

export interface CycleView {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly completedAt: string | null;
  readonly progress: CycleProgress;
  readonly groups: StateGroup[];
  readonly assignees: AssigneeTally[];
}

export interface UpcomingCycleView {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface CycleIssueRow {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly priority: number;
  readonly stateId: string;
  readonly stateName: string;
  readonly stateCategory: string;
  readonly stateColor: string;
  readonly estimate: number | null;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly assigneeImage: string | null;
}

export interface CycleIssueBreakdown {
  readonly groups: StateGroup[];
  readonly assignees: AssigneeTally[];
}

function toCategory(value: string): StateCategory {
  return STATE_CATEGORIES.find((entry) => entry === value) ?? 'backlog';
}

function groupKey(row: CycleIssueRow): string {
  return `${row.stateCategory}:${row.stateName.trim().toLowerCase()}`;
}

interface AssigneeRows {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
  readonly points: Map<string, number>;
  readonly issues: Map<string, number>;
}

export function breakDownCycleIssues(rows: readonly CycleIssueRow[]): CycleIssueBreakdown {
  const groups = new Map<string, StateGroup>();
  const tallies = new Map<string, AssigneeRows>();

  for (const row of rows) {
    const category = toCategory(row.stateCategory);
    const key = groupKey(row);
    const group = groups.get(key) ?? {
      stateId: row.stateId,
      name: row.stateName,
      category,
      color: row.stateColor,
      issues: [],
    };
    const assignee =
      row.assigneeId === null
        ? null
        : { id: row.assigneeId, name: row.assigneeName ?? 'Someone', image: row.assigneeImage };
    group.issues.push({
      id: row.id,
      identifier: row.identifier,
      title: row.title,
      priority: row.priority,
      assignee,
    });
    groups.set(key, group);

    if (assignee === null) continue;
    const tally = tallies.get(assignee.id) ?? {
      id: assignee.id,
      name: assignee.name,
      image: assignee.image,
      points: new Map<string, number>(),
      issues: new Map<string, number>(),
    };
    tally.points.set(key, (tally.points.get(key) ?? 0) + (row.estimate ?? 0));
    tally.issues.set(key, (tally.issues.get(key) ?? 0) + 1);
    tallies.set(assignee.id, tally);
  }

  const ranked = [...groups.entries()].sort(
    ([, left], [, right]) =>
      STATE_CATEGORY_ORDER[left.category] - STATE_CATEGORY_ORDER[right.category],
  );
  const order = ranked.map(([key]) => key);
  const assignees = [...tallies.values()]
    .map((tally) => {
      const points = order.map((key) => tally.points.get(key) ?? 0);
      const issues = order.map((key) => tally.issues.get(key) ?? 0);
      return {
        id: tally.id,
        name: tally.name,
        image: tally.image,
        points,
        issues,
        totalPoints: points.reduce((sum, value) => sum + value, 0),
        totalIssues: issues.reduce((sum, value) => sum + value, 0),
      };
    })
    .sort(
      (left, right) => right.totalPoints - left.totalPoints || right.totalIssues - left.totalIssues,
    );

  return { groups: ranked.map(([, group]) => group), assignees };
}

async function loadCycleIssues(cycleId: string): Promise<CycleIssueBreakdown> {
  const rows = await db
    .select({
      id: schema.issue.id,
      identifier: schema.issue.identifier,
      title: schema.issue.title,
      priority: schema.issue.priority,
      stateId: schema.workflowState.id,
      stateName: schema.workflowState.name,
      stateCategory: schema.workflowState.category,
      stateColor: schema.workflowState.color,
      statePosition: schema.workflowState.position,
      estimate: schema.issue.estimate,
      assigneeId: schema.user.id,
      assigneeName: schema.user.name,
      assigneeImage: schema.user.image,
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .leftJoin(schema.user, eq(schema.user.id, schema.issue.assigneeId))
    .where(and(eq(schema.issue.cycleId, cycleId), isNull(schema.issue.archivedAt)))
    .orderBy(asc(schema.workflowState.position), asc(schema.issue.sortOrder));

  return breakDownCycleIssues(rows);
}

export interface SprintChrome {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly completedAt: string | null;
}

export type SprintChromeView = SprintChrome & { readonly outcome: RecordedOutcome | null };
export type SprintPageView = CycleView & { readonly outcome: RecordedOutcome | null };

export function hasSprintAnalytics(
  sprint: SprintChromeView | SprintPageView,
): sprint is SprintPageView {
  return 'progress' in sprint;
}

function chromeOf(cycle: {
  id: string;
  name: string;
  number: number;
  startsAt: Date;
  endsAt: Date;
  completedAt: Date | null;
}): SprintChrome {
  return {
    id: cycle.id,
    name: sprintLabel(cycle),
    number: cycle.number,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    completedAt: cycle.completedAt?.toISOString() ?? null,
  };
}

export async function getActiveCycleView(
  principal: Principal,
  now: Date = new Date(),
): Promise<SprintPageView | null> {
  const cycle = await activeCycle(principal, now);
  if (cycle === undefined) return null;
  const [progress, issues] = await Promise.all([
    cycleProgress(principal, cycle.id, now),
    loadCycleIssues(cycle.id),
  ]);
  return {
    ...chromeOf(cycle),
    progress,
    groups: issues.groups,
    assignees: issues.assignees,
    outcome: null,
  };
}

export async function getActiveSprintChrome(
  principal: Principal,
  now: Date = new Date(),
): Promise<SprintChromeView | null> {
  const cycle = await activeCycle(principal, now);
  return cycle === undefined ? null : { ...chromeOf(cycle), outcome: null };
}

export async function getSprintChrome(
  principal: Principal,
  number: number,
): Promise<SprintChromeView | null> {
  const cycle = await getCycleByNumber(principal, number);
  if (cycle === null) return null;
  return { ...chromeOf(cycle), outcome: await sprintOutcome(principal, cycle.id) };
}

export async function runningSprintNumber(
  principal: Principal,
  now: Date = new Date(),
): Promise<number | null> {
  const cycle = await activeCycle(principal, now);
  return cycle?.number ?? null;
}

export async function listUpcomingCycleViews(
  principal: Principal,
  now: Date = new Date(),
): Promise<UpcomingCycleView[]> {
  const cycles = await upcomingCycles(principal, { now, limit: 6 });
  return cycles.map((cycle) => ({
    id: cycle.id,
    name: sprintLabel(cycle),
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
  }));
}

export interface PastSprintView {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly completedAt: string;
  readonly outcome: RecordedOutcome | null;
}

export async function listPastSprintViews(
  principal: Principal,
  limit = 12,
): Promise<PastSprintView[]> {
  const rows = await pastCycles(principal, limit);
  const outcomes = await sprintOutcomes(principal, rows);
  return rows.map((cycle, index) => ({
    id: cycle.id,
    name: sprintLabel(cycle),
    number: cycle.number,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    completedAt: (cycle.completedAt ?? cycle.endsAt).toISOString(),
    outcome: outcomes[index] ?? null,
  }));
}

export interface SprintIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly state: 'running' | 'upcoming' | 'finished' | 'overdue';
  readonly issues: number;
}

export interface SprintIndexPage {
  readonly sprints: SprintIndexEntry[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

function sprintState(
  cycle: { completedAt: Date | null; startsAt: Date; endsAt: Date },
  now: Date,
): SprintIndexEntry['state'] {
  if (cycle.completedAt !== null) return 'finished';
  if (cycle.startsAt > now) return 'upcoming';
  if (cycle.endsAt > now) return 'running';
  return 'overdue';
}

export async function listSprintIndex(
  principal: Principal,
  page: number,
  now: Date = new Date(),
): Promise<SprintIndexPage> {
  const { cycles, total, page: current, pageCount } = await pageOfCycles(principal, { page });
  if (cycles.length === 0) return { sprints: [], total, page: current, pageCount };

  const counts = await db
    .select({ cycleId: schema.issue.cycleId, total: count() })
    .from(schema.issue)
    .where(
      and(
        inArray(
          schema.issue.cycleId,
          cycles.map((cycle) => cycle.id),
        ),
        isNull(schema.issue.archivedAt),
      ),
    )
    .groupBy(schema.issue.cycleId);
  const byCycle = new Map(counts.map((row) => [row.cycleId, row.total]));

  return {
    total,
    page: current,
    pageCount,
    sprints: cycles.map((cycle) => ({
      id: cycle.id,
      name: sprintLabel(cycle),
      number: cycle.number,
      startsAt: cycle.startsAt.toISOString(),
      endsAt: cycle.endsAt.toISOString(),
      state: sprintState(cycle, now),
      issues: byCycle.get(cycle.id) ?? 0,
    })),
  };
}

export async function getSprintView(
  principal: Principal,
  number: number,
): Promise<SprintPageView | null> {
  const cycle = await getCycleByNumber(principal, number);
  if (cycle === null) return null;
  const [progress, issues, outcome] = await Promise.all([
    cycleProgress(principal, cycle.id),
    loadCycleIssues(cycle.id),
    sprintOutcome(principal, cycle.id),
  ]);
  return {
    ...chromeOf(cycle),
    progress,
    groups: issues.groups,
    assignees: issues.assignees,
    outcome,
  };
}
