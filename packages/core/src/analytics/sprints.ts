import { and, asc, db, desc, eq, inArray, schema } from '@orbit/db';
import type { AnalyticsQuery, FilterGroup, FilterNode } from '@orbit/shared';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { sprintLabel } from '@orbit/shared/utils';
import {
  type AnalyticsServiceContext,
  baseAnalyticsPredicate,
  resolveOverviewQuery,
} from './drilldown.ts';
import { reportingCalendar } from './filter.ts';
import { type Distribution, distributionOf, idealRemaining } from './math.ts';
import { selectedAssigneeIds } from './person-attribution.ts';
import type { AnalyticsCoverage, ResolvedAnalyticsQuery } from './types.ts';

const DAY_MILLISECONDS = 86_400_000;
const PLANNED_WINDOW_MILLISECONDS = DAY_MILLISECONDS;
const VELOCITY_LIMIT = 6;
const MAX_BURN_POINTS = 120;

type CycleRow = typeof schema.cycle.$inferSelect;
type MembershipRow = typeof schema.cycleIssueMembership.$inferSelect;
type OutcomeRow = typeof schema.cycleIssueOutcome.$inferSelect;
type SnapshotRow = typeof schema.cycleProgressSnapshot.$inferSelect;
type ActivityRow = typeof schema.issueActivity.$inferSelect;

export interface SprintAnalyticsContext extends AnalyticsServiceContext {
  readonly selectedSprintId?: string;
}

export interface SprintSummary {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly teamId: string | null;
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
}

export interface SprintBurnPoint {
  readonly date: string;
  readonly calendarDay: number;
  readonly workingDay: number | null;
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
  readonly remaining: number;
  readonly added: number;
  readonly removed: number;
  readonly ideal: number;
  readonly available: boolean;
  readonly future: boolean;
  readonly coverage: AnalyticsCoverage['kind'];
}

export interface SprintBaseline {
  readonly date: string;
  readonly scope: number;
  readonly retroactive: boolean;
}

export interface SprintMeasureSummary {
  readonly planned: number;
  readonly currentScope: number;
  readonly completed: number;
  readonly remaining: number;
  readonly added: number;
  readonly removed: number;
  readonly carryover: number;
  readonly unestimated: number;
}

export interface SprintScopeChanges {
  readonly added: number;
  readonly removed: number;
}

export interface SprintCohorts {
  readonly planned: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly completed: readonly string[];
  readonly incomplete: readonly string[];
  readonly carryover: readonly string[];
}

export interface SprintAttribution {
  readonly id: string;
  readonly summary: SprintMeasureSummary;
}

export interface PersonSprintBurn {
  readonly personId: string;
  readonly name: string;
  readonly burn: readonly SprintBurnPoint[];
  readonly summary: SprintMeasureSummary;
  readonly coverage: AnalyticsCoverage;
}

export interface SprintFlowDistributions {
  readonly leadTime: Distribution;
  readonly cycleTime: Distribution;
  readonly completed: number;
  readonly leadTimeCoverage: 'current-row' | 'unavailable';
  readonly cycleTimeCoverage: 'current-column' | 'reconstructed-current-column' | 'unavailable';
}

export interface SprintDetail {
  readonly sprint: SprintSummary;
  readonly measure: AnalyticsQuery['measure'];
  readonly summary: SprintMeasureSummary;
  readonly baseline: SprintBaseline | null;
  readonly counterpart: SprintMeasureSummary;
  readonly scopeChanges: SprintScopeChanges;
  readonly burn: readonly SprintBurnPoint[];
  readonly cohorts: SprintCohorts;
  readonly teams: readonly SprintAttribution[];
  readonly people: readonly PersonSprintBurn[];
  readonly flow: SprintFlowDistributions;
  readonly coverage: AnalyticsCoverage;
}

export interface SprintVelocityPoint {
  readonly sprint: SprintSummary;
  readonly planned: number;
  readonly completed: number;
  readonly carryover: number;
  readonly coverage: AnalyticsCoverage['kind'];
}

export interface SprintFormulaMetadata {
  readonly planned: string;
  readonly scope: string;
  readonly burn: string;
  readonly leadTime: string;
  readonly cycleTime: string;
  readonly points: string;
  readonly coverage: string;
}

export interface SprintAnalytics {
  readonly selected: SprintSummary | null;
  readonly current: SprintDetail | null;
  readonly previous: SprintDetail | null;
  readonly velocity: readonly SprintVelocityPoint[];
  readonly flow: SprintFlowDistributions;
  readonly focus: PersonSprintBurn | null;
  readonly coverage: AnalyticsCoverage;
  readonly formulas: SprintFormulaMetadata;
}

interface IssueFact {
  readonly issueId: string;
  readonly teamId: string;
  readonly createdAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly estimate: number | null;
  readonly assigneeId: string | null;
  readonly category: string | null;
  readonly memberships: readonly MembershipRow[];
  readonly outcome: OutcomeRow | null;
  readonly activities: readonly ActivityRow[];
}

interface SprintFacts {
  readonly cycle: CycleRow;
  readonly issues: readonly IssueFact[];
  readonly snapshots: readonly SnapshotRow[];
  readonly stateCategories: ReadonlyMap<string, string>;
}

function summaryOf(cycle: CycleRow): SprintSummary {
  return {
    id: cycle.id,
    name: sprintLabel(cycle),
    number: cycle.number,
    teamId: cycle.teamId,
    timezone: cycle.timezone,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    completedAt: cycle.completedAt?.toISOString() ?? null,
    archivedAt: cycle.archivedAt?.toISOString() ?? null,
  };
}

function selectedPersonId(query: AnalyticsQuery): string | null {
  if (query.focus.personId !== undefined) return query.focus.personId;
  const selected = selectedAssigneeIds(query).filter((value) => value !== 'unassigned');
  return selected.length === 1 ? (selected[0] ?? null) : null;
}

function withoutCycleFilter(node: FilterNode): FilterNode | true {
  if (node.kind === 'condition') return node.property === 'cycle' ? true : node;
  const children = node.children.map(withoutCycleFilter);
  if (node.combinator === 'or' && children.some((child) => child === true)) return true;
  const retained = children.filter((child): child is FilterNode => child !== true);
  if (retained.length === 0) return true;
  return { ...node, children: retained };
}

function sprintIssueFilter(query: AnalyticsQuery): FilterGroup | null {
  const filtered = withoutCycleFilter(query.filter);
  if (filtered === true) return null;
  return filtered.kind === 'group'
    ? filtered
    : { kind: 'group', combinator: 'and', children: [filtered] };
}

async function matchingIssueIds(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
  query: AnalyticsQuery,
): Promise<ReadonlySet<string> | null> {
  const filter = sprintIssueFilter(query);
  if (filter === null) return null;
  const rows = await db
    .select({ id: schema.issue.id })
    .from(schema.issue)
    .innerJoin(
      schema.workflowState,
      and(
        eq(schema.workflowState.id, schema.issue.stateId),
        eq(schema.workflowState.organizationId, schema.issue.organizationId),
        eq(schema.workflowState.teamId, schema.issue.teamId),
      ),
    )
    .where(baseAnalyticsPredicate(principal, { ...resolved, filter }));
  return new Set(rows.map((row) => row.id));
}

function dateText(value: Date, timezone: string): string {
  return reportingCalendar(value, timezone).today;
}

function addDate(day: string, amount: number): string {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function calendarDaysBetween(first: string, last: string): number {
  return Math.max(
    1,
    Math.round(
      (Date.parse(`${last}T00:00:00.000Z`) - Date.parse(`${first}T00:00:00.000Z`)) /
        DAY_MILLISECONDS,
    ) + 1,
  );
}

function sampledDayIndexes(dayCount: number): number[] {
  if (dayCount <= MAX_BURN_POINTS) {
    return Array.from({ length: dayCount }, (_, index) => index);
  }
  return Array.from({ length: MAX_BURN_POINTS }, (_, index) =>
    Math.round((index * (dayCount - 1)) / (MAX_BURN_POINTS - 1)),
  );
}

function isWorkingDay(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

function parseReferenceId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || !('id' in value)) return null;
  return typeof value.id === 'string' ? value.id : null;
}

function parseEstimate(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function categoryFromValue(value: unknown, categories: ReadonlyMap<string, string>): string | null {
  const id = parseReferenceId(value);
  if (id !== null) {
    const byId = categories.get(id);
    if (byId !== undefined) return byId;
  }
  let name: string | null = null;
  if (typeof value === 'string') name = value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string'
  ) {
    name = value.name;
  }
  return name === null ? null : (categories.get(`name:${name.trim().toLowerCase()}`) ?? null);
}

function categoryAt(fact: IssueFact, facts: SprintFacts, at: Date, now: Date): string | null {
  const changes = fact.activities.filter((activity) => activity.field === 'stateId');
  const first = changes[0];
  let category =
    first === undefined ? null : categoryFromValue(first.fromValue, facts.stateCategories);
  for (const change of changes) {
    if (change.createdAt.getTime() >= at.getTime()) break;
    category = categoryFromValue(change.toValue, facts.stateCategories) ?? category;
  }
  if (category !== null) return category;
  if (at.getTime() < endOfFacts(facts, now).getTime()) return null;
  if (fact.outcome?.outcome === 'completed') return 'completed';
  if (fact.outcome?.outcome === 'canceled') return 'canceled';
  if (fact.outcome?.outcome === 'incomplete') return 'backlog';
  return fact.category;
}

function committedAt(fact: IssueFact, facts: SprintFacts, at: Date, now: Date): boolean {
  const category = categoryAt(fact, facts, at, now);
  return category === null || !['triage', 'backlog', 'canceled'].includes(category);
}

function insideAt(fact: IssueFact, at: Date): boolean {
  const timestamp = at.getTime();
  if (fact.memberships.length === 0) {
    return fact.createdAt === null || fact.createdAt.getTime() < timestamp;
  }
  return fact.memberships.some(
    (membership) =>
      membership.addedAt.getTime() < timestamp &&
      (membership.removedAt === null || membership.removedAt.getTime() >= timestamp),
  );
}

function estimateAt(fact: IssueFact, at: Date): number | null {
  const timestamp = at.getTime();
  const membership = [...fact.memberships]
    .filter((entry) => entry.addedAt.getTime() < timestamp)
    .sort((left, right) => right.addedAt.getTime() - left.addedAt.getTime())[0];
  let estimate = membership?.estimateAtAdd ?? fact.estimate;
  for (const activity of fact.activities) {
    if (activity.field !== 'estimate' || activity.createdAt.getTime() >= timestamp) continue;
    estimate = parseEstimate(activity.toValue);
  }
  return estimate;
}

function assigneeAt(fact: IssueFact, at: Date, frozen: boolean): string | null {
  const timestamp = at.getTime();
  const membership = [...fact.memberships]
    .filter((entry) => entry.addedAt.getTime() <= timestamp)
    .sort((left, right) => right.addedAt.getTime() - left.addedAt.getTime())[0];
  const assignmentChanges = fact.activities.filter((activity) => activity.field === 'assigneeId');
  const firstChange = assignmentChanges[0];
  let assigneeId = fact.assigneeId;
  if (membership !== undefined) assigneeId = membership.assigneeIdAtAdd;
  if (membership === undefined && frozen) {
    assigneeId = firstChange === undefined ? null : parseReferenceId(firstChange.fromValue);
  }
  for (const activity of fact.activities) {
    if (
      activity.field !== 'assigneeId' ||
      activity.createdAt.getTime() >= timestamp ||
      (membership !== undefined && activity.createdAt < membership.addedAt)
    ) {
      continue;
    }
    assigneeId = parseReferenceId(activity.toValue);
  }
  if (frozen && fact.outcome !== null && timestamp >= fact.outcome.closedAt.getTime()) {
    return fact.outcome.assigneeIdAtClose;
  }
  return assigneeId;
}

function teamAt(fact: IssueFact, at: Date, frozen: boolean): string {
  const timestamp = at.getTime();
  const membership = [...fact.memberships]
    .filter(
      (entry) =>
        entry.addedAt.getTime() < timestamp &&
        (entry.removedAt === null || entry.removedAt.getTime() >= timestamp),
    )
    .sort((left, right) => right.addedAt.getTime() - left.addedAt.getTime())[0];
  if (membership !== undefined) return membership.teamId;
  if (frozen && fact.outcome !== null) return fact.outcome.teamId;
  return fact.teamId;
}

function completionAt(fact: IssueFact): Date | null {
  return fact.outcome?.completedAt ?? fact.completedAt;
}

function startedAt(fact: IssueFact): Date | null {
  return fact.startedAt;
}

function valueAt(fact: IssueFact, at: Date, measure: AnalyticsQuery['measure']): number {
  if (measure === 'issues') return 1;
  return estimateAt(fact, at) ?? 1;
}

function coverageOf(facts: SprintFacts, now: Date): AnalyticsCoverage {
  const asOf = (facts.cycle.completedAt ?? now).toISOString();
  const issueIds = new Set(facts.issues.map((fact) => fact.issueId));
  const outcomesComplete = issueIds.size > 0 && facts.issues.every((fact) => fact.outcome !== null);
  const hasFinalSnapshot = facts.snapshots.some((snapshot) => snapshot.isFinal);
  const memberships = facts.issues.flatMap((fact) => fact.memberships);
  const membershipsCaptured =
    memberships.length > 0 && memberships.every((row) => row.coverage === 'captured');
  if (
    facts.cycle.completedAt !== null &&
    outcomesComplete &&
    hasFinalSnapshot &&
    membershipsCaptured
  ) {
    return { kind: 'frozen', from: facts.cycle.startsAt.toISOString(), asOf };
  }
  if (memberships.length === 0) {
    return { kind: 'observed', from: null, asOf };
  }
  const first = memberships.reduce(
    (earliest, row) => (row.addedAt < earliest ? row.addedAt : earliest),
    memberships[0]?.addedAt ?? facts.cycle.startsAt,
  );
  let kind: AnalyticsCoverage['kind'] = 'reconstructed';
  if (facts.cycle.completedAt === null) {
    const stateHistoryCovered = facts.issues.every((fact) =>
      fact.activities.some(
        (activity) =>
          activity.field === 'stateId' &&
          categoryFromValue(activity.fromValue, facts.stateCategories) !== null,
      ),
    );
    kind =
      memberships.every((row) => row.coverage === 'captured') && stateHistoryCovered
        ? 'captured'
        : 'observed';
  }
  return { kind, from: first.toISOString(), asOf };
}

function endOfFacts(facts: SprintFacts, now: Date): Date {
  const closed = facts.cycle.completedAt;
  if (closed !== null) return closed < facts.cycle.endsAt ? closed : facts.cycle.endsAt;
  return now < facts.cycle.endsAt ? now : facts.cycle.endsAt;
}

function timeForDay(day: string, facts: SprintFacts, now: Date): Date {
  const calendar = reportingCalendar(now, facts.cycle.timezone);
  const next = calendar.startOfDay(addDate(day, 1));
  const end = endOfFacts(facts, now);
  return next < end ? next : end;
}

function completedBy(fact: IssueFact, facts: SprintFacts, at: Date, now: Date): boolean {
  const category = categoryAt(fact, facts, at, now);
  if (category !== null) return category === 'completed';
  const completedAt = completionAt(fact);
  return completedAt !== null && completedAt.getTime() < at.getTime();
}

function burnFor(
  facts: SprintFacts,
  measure: AnalyticsQuery['measure'],
  now: Date,
  personId: string | null,
  teamId: string | null = null,
): SprintBurnPoint[] {
  const startDay = dateText(facts.cycle.startsAt, facts.cycle.timezone);
  const lastDay = dateText(new Date(endOfFacts(facts, now).getTime() - 1), facts.cycle.timezone);
  const sprintFinalDay = dateText(new Date(facts.cycle.endsAt.getTime() - 1), facts.cycle.timezone);
  const coverage = coverageOf(facts, now).kind;
  const observedMemberships = facts.issues
    .flatMap((fact) => fact.memberships)
    .filter((membership) => membership.coverage === 'observed');
  const availableFrom = observedMemberships.reduce<Date | null>(
    (earliest, membership) =>
      earliest === null || membership.addedAt < earliest ? membership.addedAt : earliest,
    null,
  );
  const points: SprintBurnPoint[] = [];
  const dayIndexes = sampledDayIndexes(calendarDaysBetween(startDay, lastDay));
  for (let pointIndex = 0; pointIndex < dayIndexes.length; pointIndex += 1) {
    const dayIndex = dayIndexes[pointIndex] ?? 0;
    const day = addDate(startDay, dayIndex);
    const working = isWorkingDay(day);
    const workingDay = workingDaysBetween(startDay, day);
    const at = timeForDay(day, facts, now);
    const available = availableFrom === null || at.getTime() > availableFrom.getTime();
    const eligible = facts.issues.filter(
      (fact) =>
        committedAt(fact, facts, at, now) &&
        insideAt(fact, at) &&
        (personId === null ||
          assigneeAt(fact, at, facts.cycle.completedAt !== null) === personId) &&
        (teamId === null || teamAt(fact, at, facts.cycle.completedAt !== null) === teamId),
    );
    const scope = eligible.reduce((sum, fact) => sum + valueAt(fact, at, measure), 0);
    const completed = eligible
      .filter((fact) => completedBy(fact, facts, at, now))
      .reduce((sum, fact) => sum + valueAt(fact, at, measure), 0);
    const started = eligible
      .filter((fact) => {
        const value = startedAt(fact);
        return value !== null && value < at;
      })
      .reduce((sum, fact) => sum + valueAt(fact, at, measure), 0);
    const previousDayIndex = dayIndexes[pointIndex - 1];
    const bucketStart =
      previousDayIndex === undefined ? startDay : addDate(startDay, previousDayIndex + 1);
    const dayStart = reportingCalendar(at, facts.cycle.timezone).startOfDay(bucketStart);
    const dayEnd = reportingCalendar(at, facts.cycle.timezone).startOfDay(addDate(day, 1));
    const attributed = (membership: MembershipRow): boolean => {
      const fact = facts.issues.find((entry) => entry.issueId === membership.issueId);
      if (fact === undefined) return false;
      const personMatches =
        personId === null || assigneeAt(fact, membership.addedAt, false) === personId;
      return personMatches && (teamId === null || membership.teamId === teamId);
    };
    const added = facts.issues
      .flatMap((fact) => fact.memberships)
      .filter(
        (entry) =>
          entry.entryKind !== 'bootstrap' &&
          entry.addedAt >= dayStart &&
          entry.addedAt < dayEnd &&
          attributed(entry),
      )
      .reduce((sum, entry) => {
        if (measure === 'issues') return sum + 1;
        return sum + (entry.estimateAtAdd ?? 1);
      }, 0);
    const removed = facts.issues
      .flatMap((fact) => fact.memberships)
      .filter(
        (entry) =>
          entry.removedAt !== null &&
          entry.removedAt >= dayStart &&
          entry.removedAt < dayEnd &&
          attributed(entry),
      )
      .reduce((sum, entry) => {
        if (measure === 'issues') return sum + 1;
        return sum + (entry.estimateAtAdd ?? 1);
      }, 0);
    points.push({
      date: day,
      calendarDay: dayIndex + 1,
      workingDay: working ? workingDay : null,
      scope,
      started,
      completed,
      remaining: Math.max(0, scope - completed),
      added,
      removed,
      ideal: 0,
      available,
      future: false,
      coverage,
    });
  }
  const lastObservedDay = points.at(-1)?.date ?? startDay;
  if (lastObservedDay < sprintFinalDay) {
    let day = addDate(lastObservedDay, 1);
    while (day <= sprintFinalDay) {
      const working = isWorkingDay(day);
      points.push({
        date: day,
        calendarDay: calendarDaysBetween(startDay, day),
        workingDay: working ? workingDaysBetween(startDay, day) : null,
        scope: 0,
        started: 0,
        completed: 0,
        remaining: 0,
        added: 0,
        removed: 0,
        ideal: 0,
        available: false,
        future: true,
        coverage,
      });
      day = addDate(day, 1);
    }
  }
  const baseline = points.find((point) => point.available && !point.future);
  const initialScope = baseline?.scope ?? 0;
  const plannedWorkingDays = Math.max(1, workingDaysBetween(startDay, sprintFinalDay));
  return points.map((point) => ({
    ...point,
    ideal: idealRemaining(
      initialScope,
      workingDaysBetween(startDay, point.date) - 1,
      plannedWorkingDays - 1,
    ),
  }));
}

function workingDaysBetween(first: string, last: string): number {
  const days = calendarDaysBetween(first, last);
  const fullWeeks = Math.floor(days / 7);
  let count = fullWeeks * 5;
  const remainder = days % 7;
  for (let offset = 0; offset < remainder; offset += 1) {
    if (isWorkingDay(addDate(first, fullWeeks * 7 + offset))) count += 1;
  }
  return count;
}

function membershipEvents(
  facts: SprintFacts,
  now: Date,
): {
  readonly added: readonly MembershipRow[];
  readonly removed: readonly MembershipRow[];
} {
  const end = endOfFacts(facts, now);
  const added = facts.issues
    .flatMap((fact) => fact.memberships)
    .filter(
      (entry) =>
        entry.entryKind !== 'bootstrap' &&
        entry.addedAt >= facts.cycle.startsAt &&
        entry.addedAt <= end,
    );
  const removed = facts.issues
    .flatMap((fact) => fact.memberships)
    .filter(
      (entry) =>
        entry.removedAt !== null &&
        entry.removedAt >= facts.cycle.startsAt &&
        entry.removedAt <= end,
    );
  return { added, removed };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function cohortsOf(facts: SprintFacts, now: Date): SprintCohorts {
  const cutoff = facts.cycle.startsAt.getTime() + PLANNED_WINDOW_MILLISECONDS;
  const events = membershipEvents(facts, now);
  const planned = facts.issues.filter((fact) => {
    if (fact.outcome !== null) return fact.outcome.planned;
    return fact.memberships.some(
      (entry) =>
        entry.coverage === 'captured' &&
        entry.addedAt.getTime() <= cutoff &&
        committedAt(fact, facts, entry.addedAt, now),
    );
  });
  const completed = facts.issues.filter((fact) => {
    if (fact.outcome !== null) return fact.outcome.outcome === 'completed';
    return completionAt(fact) !== null;
  });
  const carryover = facts.issues.filter(
    (fact) =>
      fact.outcome?.outcome === 'carryover' ||
      fact.memberships.some((entry) => entry.entryKind === 'rollover'),
  );
  const incomplete = facts.issues.filter(
    (fact) =>
      fact.outcome?.outcome === 'incomplete' ||
      (fact.outcome === null &&
        committedAt(fact, facts, endOfFacts(facts, now), now) &&
        !completedBy(fact, facts, endOfFacts(facts, now), now)),
  );
  return {
    planned: planned.map((fact) => fact.issueId),
    added: unique(events.added.map((entry) => entry.issueId)),
    removed: unique(events.removed.map((entry) => entry.issueId)),
    completed: completed.map((fact) => fact.issueId),
    incomplete: incomplete.map((fact) => fact.issueId),
    carryover: carryover.map((fact) => fact.issueId),
  };
}

function summaryFor(
  facts: SprintFacts,
  burn: readonly SprintBurnPoint[],
  cohorts: SprintCohorts,
  measure: AnalyticsQuery['measure'],
  now: Date,
  personId: string | null,
  teamId: string | null = null,
  options: { readonly baselineScope: number | null } = { baselineScope: null },
): SprintMeasureSummary {
  const at = endOfFacts(facts, now);
  const personFacts = facts.issues.filter(
    (fact) =>
      (personId === null || assigneeAt(fact, at, facts.cycle.completedAt !== null) === personId) &&
      (teamId === null || teamAt(fact, at, facts.cycle.completedAt !== null) === teamId),
  );
  const sumCohort = (ids: readonly string[]): number =>
    personFacts
      .filter((fact) => ids.includes(fact.issueId))
      .reduce((sum, fact) => sum + valueAt(fact, at, measure), 0);
  const last = burn.filter((point) => !point.future).at(-1);
  const events = membershipEvents(facts, now);
  const attributedEvents = (rows: readonly MembershipRow[]): MembershipRow[] =>
    rows.filter((row) => {
      const fact = facts.issues.find((entry) => entry.issueId === row.issueId);
      if (fact === undefined) return false;
      return (
        (personId === null || assigneeAt(fact, row.addedAt, false) === personId) &&
        (teamId === null || row.teamId === teamId)
      );
    });
  const eventValue = (rows: readonly MembershipRow[]): number =>
    attributedEvents(rows).reduce(
      (sum, row) => sum + (measure === 'issues' ? 1 : (row.estimateAtAdd ?? 1)),
      0,
    );
  const currentFacts = personFacts.filter(
    (fact) => committedAt(fact, facts, at, now) && insideAt(fact, at),
  );
  const captured = sumCohort(cohorts.planned);
  return {
    planned: captured > 0 ? captured : (options.baselineScope ?? 0),
    currentScope: last?.scope ?? 0,
    completed: last?.completed ?? 0,
    remaining: last?.remaining ?? 0,
    added: eventValue(events.added),
    removed: eventValue(events.removed),
    carryover: sumCohort(cohorts.carryover),
    unestimated: currentFacts.filter((fact) => estimateAt(fact, at) === null).length,
  };
}

function flowFor(facts: SprintFacts): SprintFlowDistributions {
  const completed = facts.issues.filter((fact) => completionAt(fact) !== null);
  const lead = completed.flatMap((fact) => {
    const end = completionAt(fact);
    if (end === null || fact.createdAt === null || end < fact.createdAt) return [];
    return [(end.getTime() - fact.createdAt.getTime()) / DAY_MILLISECONDS];
  });
  const cycle = completed.flatMap((fact) => {
    const end = completionAt(fact);
    const start = startedAt(fact);
    if (end === null || start === null || end < start) return [];
    return [(end.getTime() - start.getTime()) / DAY_MILLISECONDS];
  });
  let cycleTimeCoverage: SprintFlowDistributions['cycleTimeCoverage'] = 'unavailable';
  if (cycle.length > 0) {
    cycleTimeCoverage =
      facts.cycle.completedAt === null ? 'current-column' : 'reconstructed-current-column';
  }
  return {
    leadTime: distributionOf(lead),
    cycleTime: distributionOf(cycle),
    completed: completed.length,
    leadTimeCoverage: lead.length === 0 ? 'unavailable' : 'current-row',
    cycleTimeCoverage,
  };
}

function baselinePointOf(burn: readonly SprintBurnPoint[]): SprintBurnPoint | undefined {
  return burn.find((point) => point.available && !point.future);
}

function detailFor(
  facts: SprintFacts,
  measure: AnalyticsQuery['measure'],
  now: Date,
  names: ReadonlyMap<string, string>,
): SprintDetail {
  const burn = burnFor(facts, measure, now, null);
  const cohorts = cohortsOf(facts, now);
  const baselinePoint = baselinePointOf(burn);
  const at = endOfFacts(facts, now);
  const capturedPlanned = facts.issues
    .filter((fact) => cohorts.planned.includes(fact.issueId))
    .reduce((sum, fact) => sum + valueAt(fact, at, measure), 0);
  const baseline =
    baselinePoint === undefined
      ? null
      : {
          date: baselinePoint.date,
          scope: baselinePoint.scope,
          retroactive: capturedPlanned === 0 && baselinePoint.scope > 0,
        };
  const summary = summaryFor(facts, burn, cohorts, measure, now, null, null, {
    baselineScope: baselinePoint?.scope ?? null,
  });
  const otherMeasure = measure === 'issues' ? ('points' as const) : ('issues' as const);
  const counterpartBurn = burnFor(facts, otherMeasure, now, null);
  const counterpartBaseline = baselinePointOf(counterpartBurn);
  const counterpart = summaryFor(facts, counterpartBurn, cohorts, otherMeasure, now, null, null, {
    baselineScope: counterpartBaseline?.scope ?? null,
  });
  const personIds = unique(
    facts.issues.flatMap((fact) => [
      ...(fact.assigneeId === null ? [] : [fact.assigneeId]),
      ...fact.memberships.flatMap((row) =>
        row.assigneeIdAtAdd === null ? [] : [row.assigneeIdAtAdd],
      ),
      ...(fact.outcome?.assigneeIdAtClose === null || fact.outcome?.assigneeIdAtClose === undefined
        ? []
        : [fact.outcome.assigneeIdAtClose]),
    ]),
  );
  const people = personIds.map((personId) => {
    const personBurn = burnFor(facts, measure, now, personId);
    const personBaseline = baselinePointOf(personBurn);
    return {
      personId,
      name: names.get(personId) ?? 'Former member',
      burn: personBurn,
      summary: summaryFor(facts, personBurn, cohorts, measure, now, personId, null, {
        baselineScope: personBaseline?.scope ?? null,
      }),
      coverage: coverageOf(facts, now),
    };
  });
  const teamIds = unique(
    facts.issues.flatMap((fact) => [
      fact.teamId,
      ...fact.memberships.map((row) => row.teamId),
      ...(fact.outcome === null ? [] : [fact.outcome.teamId]),
    ]),
  );
  const teams = teamIds.map((teamId) => {
    const teamBurn = burnFor(facts, measure, now, null, teamId);
    const teamBaseline = baselinePointOf(teamBurn);
    return {
      id: teamId,
      summary: summaryFor(facts, teamBurn, cohorts, measure, now, null, teamId, {
        baselineScope: teamBaseline?.scope ?? null,
      }),
    };
  });
  return {
    sprint: summaryOf(facts.cycle),
    measure,
    summary,
    baseline,
    counterpart,
    scopeChanges: { added: summary.added, removed: summary.removed },
    burn,
    cohorts,
    teams,
    people,
    flow: flowFor(facts),
    coverage: coverageOf(facts, now),
  };
}

async function loadFacts(
  cycles: readonly CycleRow[],
  allowedIssueIds: ReadonlySet<string> | null,
): Promise<{
  readonly facts: ReadonlyMap<string, SprintFacts>;
  readonly names: ReadonlyMap<string, string>;
}> {
  const cycleIds = cycles.map((cycle) => cycle.id);
  const allMemberships =
    cycleIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.cycleIssueMembership)
          .where(inArray(schema.cycleIssueMembership.cycleId, cycleIds))
          .orderBy(asc(schema.cycleIssueMembership.addedAt), asc(schema.cycleIssueMembership.id));
  const allOutcomes =
    cycleIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.cycleIssueOutcome)
          .where(inArray(schema.cycleIssueOutcome.cycleId, cycleIds));
  const memberships =
    allowedIssueIds === null
      ? allMemberships
      : allMemberships.filter((row) => allowedIssueIds.has(row.issueId));
  const outcomes =
    allowedIssueIds === null
      ? allOutcomes
      : allOutcomes.filter((row) => allowedIssueIds.has(row.issueId));
  const snapshots =
    cycleIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.cycleProgressSnapshot)
          .where(inArray(schema.cycleProgressSnapshot.cycleId, cycleIds))
          .orderBy(asc(schema.cycleProgressSnapshot.capturedOn));
  const issueIds = unique([
    ...memberships.map((row) => row.issueId),
    ...outcomes.map((row) => row.issueId),
  ]);
  const current =
    issueIds.length === 0
      ? []
      : await db
          .select({ issue: schema.issue, category: schema.workflowState.category })
          .from(schema.issue)
          .innerJoin(
            schema.workflowState,
            and(
              eq(schema.workflowState.id, schema.issue.stateId),
              eq(schema.workflowState.organizationId, schema.issue.organizationId),
              eq(schema.workflowState.teamId, schema.issue.teamId),
            ),
          )
          .where(inArray(schema.issue.id, issueIds));
  const assigned =
    cycleIds.length === 0
      ? []
      : await db
          .select({ issue: schema.issue, category: schema.workflowState.category })
          .from(schema.issue)
          .innerJoin(
            schema.workflowState,
            and(
              eq(schema.workflowState.id, schema.issue.stateId),
              eq(schema.workflowState.organizationId, schema.issue.organizationId),
              eq(schema.workflowState.teamId, schema.issue.teamId),
            ),
          )
          .where(inArray(schema.issue.cycleId, cycleIds));
  const currentRows = [
    ...new Map([...current, ...assigned].map((row) => [row.issue.id, row])).values(),
  ].filter((row) => allowedIssueIds === null || allowedIssueIds.has(row.issue.id));
  const allIssueIds = unique([...issueIds, ...currentRows.map((row) => row.issue.id)]);
  const activities =
    allIssueIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.issueActivity)
          .where(inArray(schema.issueActivity.issueId, allIssueIds))
          .orderBy(asc(schema.issueActivity.createdAt), asc(schema.issueActivity.id));
  const organizationIds = unique(cycles.map((cycle) => cycle.organizationId));
  const states =
    organizationIds.length === 0
      ? []
      : await db
          .select({
            id: schema.workflowState.id,
            name: schema.workflowState.name,
            category: schema.workflowState.category,
          })
          .from(schema.workflowState)
          .where(inArray(schema.workflowState.organizationId, organizationIds));
  const stateCategories = new Map<string, string>();
  for (const state of states) {
    stateCategories.set(state.id, state.category);
    stateCategories.set(`name:${state.name.trim().toLowerCase()}`, state.category);
  }
  const currentById = new Map(currentRows.map((row) => [row.issue.id, row]));
  const outcomeByKey = new Map(outcomes.map((row) => [`${row.cycleId}:${row.issueId}`, row]));
  const membershipsByCycle = new Map<string, MembershipRow[]>();
  for (const row of memberships) {
    const list = membershipsByCycle.get(row.cycleId) ?? [];
    list.push(row);
    membershipsByCycle.set(row.cycleId, list);
  }
  const activitiesByIssue = new Map<string, ActivityRow[]>();
  for (const row of activities) {
    const list = activitiesByIssue.get(row.issueId) ?? [];
    list.push(row);
    activitiesByIssue.set(row.issueId, list);
  }
  const facts = new Map<string, SprintFacts>();
  for (const cycle of cycles) {
    const ownMemberships = membershipsByCycle.get(cycle.id) ?? [];
    const ownIssueIds = unique([
      ...ownMemberships.map((row) => row.issueId),
      ...outcomes.filter((row) => row.cycleId === cycle.id).map((row) => row.issueId),
      ...currentRows.filter((row) => row.issue.cycleId === cycle.id).map((row) => row.issue.id),
    ]);
    const issues = ownIssueIds.flatMap((issueId): IssueFact[] => {
      const own = ownMemberships.filter((row) => row.issueId === issueId);
      const outcome = outcomeByKey.get(`${cycle.id}:${issueId}`) ?? null;
      const currentRow = currentById.get(issueId);
      const first = own[0];
      if (currentRow === undefined && first === undefined && outcome === null) return [];
      return [
        {
          issueId,
          teamId: currentRow?.issue.teamId ?? outcome?.teamId ?? first?.teamId ?? '',
          createdAt: currentRow?.issue.createdAt ?? null,
          startedAt: currentRow?.issue.startedAt ?? null,
          completedAt: currentRow?.issue.completedAt ?? null,
          estimate:
            currentRow?.issue.estimate ?? outcome?.estimateAtClose ?? first?.estimateAtAdd ?? null,
          assigneeId: currentRow?.issue.assigneeId ?? null,
          category: currentRow?.category ?? null,
          memberships: own,
          outcome,
          activities: activitiesByIssue.get(issueId) ?? [],
        },
      ];
    });
    facts.set(cycle.id, {
      cycle,
      issues,
      snapshots: snapshots.filter((row) => row.cycleId === cycle.id),
      stateCategories,
    });
  }
  const personIds = unique(
    memberships
      .flatMap((row) => (row.assigneeIdAtAdd === null ? [] : [row.assigneeIdAtAdd]))
      .concat(
        outcomes.flatMap((row) => (row.assigneeIdAtClose === null ? [] : [row.assigneeIdAtClose])),
        currentRows.flatMap((row) => (row.issue.assigneeId === null ? [] : [row.issue.assigneeId])),
      ),
  );
  const people =
    personIds.length === 0
      ? []
      : await db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, personIds));
  return { facts, names: new Map(people.map((person) => [person.id, person.name])) };
}

function formulas(): SprintFormulaMetadata {
  return {
    planned:
      'Captured sprint membership entered before the sprint start or within 24 hours after it. Known triage, backlog, or canceled state at commitment is excluded; missing state-at-entry coverage is retained as membership-planned rather than inferred from current state.',
    scope:
      'Membership active at the observation time, excluding triage, backlog, or canceled work only where a state transition or observation establishes that category.',
    burn: 'Remaining equals scope minus completed on each sprint local calendar day. Dates before an observed membership baseline are unavailable rather than zero. Observed bootstrap membership establishes the baseline and is not counted as added scope. The ideal line starts at sprint day 1 using the first reliable scope baseline and holds flat over weekends. State-transition facts preserve completion and reopen episodes; current-day values include captured facts after the latest snapshot.',
    leadTime:
      'Current issue-row creation to durable completion for issues whose creation row remains available; deleted rows are unavailable.',
    cycleTime:
      'Current mutable startedAt column to completion. Completed sprint values are labeled reconstructed-current-column, never frozen, because close outcomes do not retain first start.',
    points: 'Unestimated work counts as 1 point until estimated.',
    coverage:
      'Captured requires captured active membership facts, observed includes bootstrap or missing entry-state facts, frozen requires outcomes for every relevant issue plus a final snapshot, and completed partial history is reconstructed.',
  };
}

function emptySprintAnalytics(asOf: Date): SprintAnalytics {
  return {
    selected: null,
    current: null,
    previous: null,
    velocity: [],
    flow: {
      leadTime: distributionOf([]),
      cycleTime: distributionOf([]),
      completed: 0,
      leadTimeCoverage: 'unavailable',
      cycleTimeCoverage: 'unavailable',
    },
    focus: null,
    coverage: { kind: 'live', from: null, asOf: asOf.toISOString() },
    formulas: formulas(),
  };
}

export async function loadSprintAnalytics(
  principal: Principal,
  query: AnalyticsQuery,
  context: SprintAnalyticsContext = {},
): Promise<SprintAnalytics> {
  assertCan(principal, 'analytics:read');
  const resolutionContext: AnalyticsServiceContext = {};
  const resolved = await resolveOverviewQuery(principal, query, {
    ...resolutionContext,
    ...(context.now === undefined ? {} : { now: context.now }),
    ...(context.timezone === undefined ? {} : { timezone: context.timezone }),
  });
  const cycles = await db
    .select()
    .from(schema.cycle)
    .where(eq(schema.cycle.organizationId, principal.organizationId))
    .orderBy(desc(schema.cycle.number));
  const selectedId = context.selectedSprintId ?? resolved.selectedSprintId;
  const selected =
    cycles.find((cycle) => cycle.id === selectedId) ??
    cycles.find(
      (cycle) =>
        cycle.archivedAt === null &&
        cycle.completedAt === null &&
        cycle.startsAt <= resolved.asOf &&
        cycle.endsAt > resolved.asOf,
    ) ??
    cycles.find((cycle) => cycle.completedAt !== null);
  if (selected === undefined) return emptySprintAnalytics(resolved.asOf);
  const previous = cycles
    .filter(
      (cycle) =>
        cycle.id !== selected.id &&
        cycle.archivedAt === null &&
        cycle.completedAt !== null &&
        cycle.completedAt <= resolved.asOf &&
        cycle.endsAt <= selected.startsAt,
    )
    .sort(
      (left, right) =>
        right.endsAt.getTime() - left.endsAt.getTime() ||
        (right.completedAt?.getTime() ?? 0) - (left.completedAt?.getTime() ?? 0) ||
        right.id.localeCompare(left.id),
    )[0];
  const velocityCycles = cycles
    .filter(
      (cycle) =>
        cycle.archivedAt === null &&
        cycle.completedAt !== null &&
        cycle.completedAt <= resolved.asOf,
    )
    .sort(
      (left, right) =>
        (left.completedAt?.getTime() ?? 0) - (right.completedAt?.getTime() ?? 0) ||
        left.endsAt.getTime() - right.endsAt.getTime() ||
        left.number - right.number ||
        left.id.localeCompare(right.id),
    )
    .slice(-VELOCITY_LIMIT);
  const wanted = [selected, ...(previous === undefined ? [] : [previous]), ...velocityCycles];
  const uniqueCycles = [...new Map(wanted.map((cycle) => [cycle.id, cycle])).values()];
  const allowedIssueIds = await matchingIssueIds(principal, resolved, query);
  const loaded = await loadFacts(uniqueCycles, allowedIssueIds);
  const selectedFacts = loaded.facts.get(selected.id);
  if (selectedFacts === undefined) throw new Error('The selected sprint facts are unavailable.');
  const current = detailFor(selectedFacts, query.measure, resolved.asOf, loaded.names);
  const previousFacts = previous === undefined ? undefined : loaded.facts.get(previous.id);
  const previousDetail =
    previousFacts === undefined
      ? null
      : detailFor(previousFacts, query.measure, resolved.asOf, loaded.names);
  const velocity = velocityCycles.flatMap((cycle): SprintVelocityPoint[] => {
    const facts = loaded.facts.get(cycle.id);
    if (facts === undefined) return [];
    const detail = detailFor(facts, query.measure, resolved.asOf, loaded.names);
    return [
      {
        sprint: detail.sprint,
        planned: detail.summary.planned,
        completed: detail.summary.completed,
        carryover: detail.summary.carryover,
        coverage: detail.coverage.kind,
      },
    ];
  });
  const personId = selectedPersonId(query);
  const focus =
    personId === null
      ? null
      : (current.people.find((person) => person.personId === personId) ?? null);
  return {
    selected: current.sprint,
    current,
    previous: previousDetail,
    velocity,
    flow: current.flow,
    focus,
    coverage: current.coverage,
    formulas: formulas(),
  };
}
