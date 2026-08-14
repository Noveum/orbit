import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, db, eq, gt, isNotNull, isNull, schema, sql } from '@orbit/db';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  STATE_CATEGORIES,
  type StateCategory,
} from '@orbit/shared/constants';
import { validationFailed } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import type { AnalyticsDrilldownCohort, AnalyticsQuery } from '@orbit/shared/validators';
import { issueFilterSchema } from '@orbit/shared/validators';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { buildIssueWhere } from '../work/issue-query.ts';
import {
  bucketDates,
  calendarDateLabel,
  reportingCalendar,
  resolveAnalyticsQuery,
} from './filter.ts';
import {
  completionAttributionPerson,
  historicalPersonFilter,
  personMatches,
  selectedAssigneeIds,
  UNASSIGNED_PERSON_ID,
} from './person-attribution.ts';
import type { AnalyticsResolutionContext, ResolvedAnalyticsQuery } from './types.ts';

const MAX_LIMIT = 200;
const STALE_DAYS = 14;
const DISTRIBUTION_CAP = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ANALYTICS_OVERVIEW_COHORTS = [
  'current',
  'created',
  'completed',
  'throughput',
  'comparison-throughput',
  'cycle-time',
  'wip',
  'blocked',
  'overdue',
  'stale',
  'unestimated',
  'delivery-created',
  'delivery-completed',
  'delivery-open',
] as const;

const PROJECT_COHORT_METRICS = [
  'current',
  'open',
  'completed',
  'blocked',
  'overdue',
  'stale',
  'unestimated',
  'added',
  'completed-range',
  'delivery-scope',
  'delivery-started',
  'delivery-completed',
  'delivery-completed-bucket',
  'delivery-open',
  'delivery-added',
] as const;

type ProjectCohortMetric = (typeof PROJECT_COHORT_METRICS)[number];

interface ProjectCohort {
  readonly kind: 'project';
  readonly metric: ProjectCohortMetric;
  readonly id: string;
}

interface MilestoneCohort {
  readonly kind: 'milestone';
  readonly metric: 'current' | 'completed';
  readonly id: string;
}

type PlanningCohort = ProjectCohort | MilestoneCohort;

const PERSON_COHORT_METRICS = [
  'current',
  'completed',
  'wip',
  'blocked',
  'overdue',
  'stale',
  'unestimated',
  'assigned',
] as const;

type PersonCohortMetric = (typeof PERSON_COHORT_METRICS)[number];

interface PersonCohort {
  readonly metric: PersonCohortMetric;
  readonly id: string;
}

type PersonGroupDimension = 'project' | 'milestone' | 'sprint' | 'state';

interface PersonGroupCohort {
  readonly dimension: PersonGroupDimension;
  readonly id: string;
}

export type AnalyticsOverviewCohortKey =
  | (typeof ANALYTICS_OVERVIEW_COHORTS)[number]
  | `state:${string}`
  | `project:${string}`
  | `priority:${number}`
  | `outlier:${string}`;

export interface AnalyticsServiceContext {
  readonly now?: Date;
  readonly timezone?: string;
  readonly cursorSecret?: string;
}

export interface AnalyticsIssueRow {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly priority: number;
  readonly estimate: number | null;
  readonly dueDate: string | null;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly cycleTimeDays: number | null;
  readonly state: { readonly id: string; readonly name: string; readonly category: string };
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly assignee: {
    readonly id: string;
    readonly name: string;
    readonly image: string | null;
  } | null;
}

export interface AnalyticsDrilldownDetails {
  readonly validCycleCount: number;
  readonly cycleTimeP50: number | null;
  readonly cycleTimeP85: number | null;
}

export interface AnalyticsDrilldownPage {
  readonly predicate: string;
  readonly total: number;
  readonly totalValue: number;
  readonly details: AnalyticsDrilldownDetails;
  readonly issues: readonly AnalyticsIssueRow[];
  readonly nextCursor: string | null;
  readonly limit: number;
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
}

export interface AnalyticsDrilldownInput {
  readonly query: AnalyticsQuery;
  readonly cohort: AnalyticsDrilldownCohort;
  readonly cursor?: string;
  readonly limit?: number;
}

interface CursorValue {
  readonly id: string;
  readonly resolution: CursorResolution;
}

interface CursorResolution {
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  readonly comparisonFrom: string | null;
  readonly comparisonTo: string | null;
  readonly timezone: string;
}

interface AggregateRow {
  readonly [key: string]: unknown;
  readonly total: number | string;
  readonly total_value: number | string;
  readonly valid_cycle_count: number | string;
  readonly cycle_time_p50: number | string | null;
  readonly cycle_time_p85: number | string | null;
}

interface PageRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly priority: number | string;
  readonly estimate: number | string | null;
  readonly due_date: string | null;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly cycle_time_days: number | string | null;
  readonly state_id: string;
  readonly state_name: string;
  readonly state_category: string;
  readonly project_id: string | null;
  readonly project_name: string | null;
  readonly assignee_id: string | null;
  readonly assignee_name: string | null;
  readonly assignee_image: string | null;
}

function analyticsIssueFilter(query: AnalyticsQuery) {
  return issueFilterSchema.parse({
    filter: query.filter,
    includeArchived: query.includeArchived,
    includeSubIssues: true,
  });
}

export async function resolveOverviewQuery(
  principal: Principal,
  query: AnalyticsQuery,
  context: AnalyticsServiceContext = {},
): Promise<ResolvedAnalyticsQuery> {
  assertCan(principal, 'analytics:read');
  const now = context.now ?? new Date();
  const [person, cycles, earliest] = await Promise.all([
    db
      .select({ timezone: schema.user.timezone })
      .from(schema.user)
      .where(eq(schema.user.id, principal.userId))
      .limit(1),
    db
      .select({
        id: schema.cycle.id,
        teamId: schema.cycle.teamId,
        timezone: schema.cycle.timezone,
        startsAt: schema.cycle.startsAt,
        endsAt: schema.cycle.endsAt,
        completedAt: schema.cycle.completedAt,
        archivedAt: schema.cycle.archivedAt,
      })
      .from(schema.cycle)
      .where(eq(schema.cycle.organizationId, principal.organizationId)),
    db
      .select({ createdAt: schema.issue.createdAt })
      .from(schema.issue)
      .where(eq(schema.issue.organizationId, principal.organizationId))
      .orderBy(asc(schema.issue.createdAt))
      .limit(1),
  ]);
  const resolution: AnalyticsResolutionContext = {
    now,
    timezone: context.timezone ?? person[0]?.timezone ?? 'UTC',
    cycles,
    earliestIssueAt: earliest[0]?.createdAt ?? null,
  };
  return resolveAnalyticsQuery(query, resolution);
}

export function baseAnalyticsPredicate(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
): SQL<unknown> {
  const filters: SQL[] = [
    buildIssueWhere(principal, {
      visibility: 'workspace-analytics',
      filter: analyticsIssueFilter(resolved),
      now: resolved.asOf,
      calendar: reportingCalendar(resolved.asOf, resolved.timezone),
    }),
  ];
  if (!resolved.includeCanceled) filters.push(sql`${schema.workflowState.category} <> 'canceled'`);
  return and(...filters) ?? sql`false`;
}

function otherDimensionPredicate(
  resolved: ResolvedAnalyticsQuery,
  base: SQL<unknown> | undefined,
  dimension: 'state' | 'project',
): SQL<unknown> {
  if (base === undefined) throw validationFailed('That analytics cohort is not valid here.');
  const dimensionId =
    dimension === 'state'
      ? sql`${schema.issue.stateId}`
      : sql`coalesce(${schema.issue.projectId}, 'none')`;
  const weight = resolved.measure === 'points' ? sql`coalesce(issue.estimate, 0)` : sql`1`;
  return sql`${dimensionId} not in (
    select ranked.dimension_id from (
      select ${dimensionId} as dimension_id
      from issue join workflow_state on workflow_state.id = issue.state_id
      where ${base}
      group by ${dimensionId}
      order by sum(${weight}) desc, ${dimensionId} asc
      limit ${DISTRIBUTION_CAP}
    ) ranked
  )`;
}

function dimensionCohortPredicate(
  resolved: ResolvedAnalyticsQuery,
  cohort: AnalyticsDrilldownCohort,
  base: SQL<unknown> | undefined,
): SQL<unknown> | null {
  if (cohort.cohort.startsWith('state-category:')) {
    return eq(
      schema.workflowState.category,
      cohort.cohort.slice('state-category:'.length) as StateCategory,
    );
  }
  if (cohort.cohort.startsWith('state:')) {
    const stateId = cohort.cohort.slice('state:'.length);
    return stateId === 'other'
      ? otherDimensionPredicate(resolved, base, 'state')
      : eq(schema.issue.stateId, stateId);
  }
  if (cohort.cohort.startsWith('project:')) {
    const projectId = cohort.cohort.slice('project:'.length);
    if (projectId === 'none') return isNull(schema.issue.projectId);
    return projectId === 'other'
      ? otherDimensionPredicate(resolved, base, 'project')
      : eq(schema.issue.projectId, projectId);
  }
  if (cohort.cohort.startsWith('priority:')) {
    return eq(schema.issue.priority, Number(cohort.cohort.slice('priority:'.length)));
  }
  if (cohort.cohort.startsWith('outlier:')) {
    return eq(schema.issue.id, cohort.cohort.slice('outlier:'.length));
  }
  return null;
}

function validIdCohort(value: string, prefix: string, special: ReadonlySet<string>): boolean {
  const match = new RegExp(`^${prefix}:(.+)$`, 'i').exec(value);
  const suffix = match?.[1];
  return suffix !== undefined && (special.has(suffix) || UUID_PATTERN.test(suffix));
}

function validDimensionCohort(value: string): boolean {
  const stateCategory = /^state-category:([a-z]+)$/.exec(value);
  if (
    stateCategory !== null &&
    STATE_CATEGORIES.some((category) => category === stateCategory[1])
  ) {
    return true;
  }
  if (validIdCohort(value, 'state', new Set(['other']))) return true;
  if (validIdCohort(value, 'project', new Set(['none', 'other']))) return true;
  if (validIdCohort(value, 'outlier', new Set())) return true;
  const priority = /^priority:(\d+)$/.exec(value);
  return priority !== null && PRIORITIES.some((entry) => String(entry) === priority[1]);
}

function planningCohort(value: string): PlanningCohort | null {
  const project = /^project-([a-z-]+):(.+)$/.exec(value);
  const projectMetric = project?.[1];
  const projectId = project?.[2];
  if (
    projectMetric !== undefined &&
    projectId !== undefined &&
    UUID_PATTERN.test(projectId) &&
    PROJECT_COHORT_METRICS.some((metric) => metric === projectMetric)
  ) {
    return { kind: 'project', metric: projectMetric as ProjectCohortMetric, id: projectId };
  }
  const milestone = /^milestone-(current|completed):(.+)$/.exec(value);
  const milestoneMetric = milestone?.[1];
  const milestoneId = milestone?.[2];
  if (
    milestoneMetric !== undefined &&
    milestoneId !== undefined &&
    UUID_PATTERN.test(milestoneId)
  ) {
    return {
      kind: 'milestone',
      metric: milestoneMetric === 'completed' ? 'completed' : 'current',
      id: milestoneId,
    };
  }
  return null;
}

function validPersonId(value: string): boolean {
  return value === UNASSIGNED_PERSON_ID || UUID_PATTERN.test(value);
}

function personCohort(value: string): PersonCohort | null {
  const match = /^person-([a-z-]+):(.+)$/.exec(value);
  const metric = match?.[1];
  const id = match?.[2];
  if (
    metric === undefined ||
    id === undefined ||
    !validPersonId(id) ||
    !PERSON_COHORT_METRICS.some((candidate) => candidate === metric)
  ) {
    return null;
  }
  return { metric: metric as PersonCohortMetric, id };
}

function personGroupCohort(value: string): PersonGroupCohort | null {
  const match = /^person-(project|milestone|sprint|state):(.+)$/.exec(value);
  const dimension = match?.[1];
  const id = match?.[2];
  if (dimension === undefined || id === undefined || !UUID_PATTERN.test(id)) return null;
  return { dimension: dimension as PersonGroupDimension, id };
}

function validateBucketRequirement(
  cohort: AnalyticsDrilldownCohort,
  requirement: 'required' | 'forbidden' | 'optional',
): AnalyticsDrilldownCohort {
  if (requirement === 'required' && cohort.bucket === undefined) {
    throw validationFailed('That analytics cohort needs a bucket.');
  }
  if (requirement === 'forbidden' && cohort.bucket !== undefined) {
    throw validationFailed('That analytics cohort has no bucket.');
  }
  return cohort;
}

function planningBucketRequirement(planning: PlanningCohort): 'required' | 'forbidden' {
  return planning.kind === 'project' && planning.metric.startsWith('delivery-')
    ? 'required'
    : 'forbidden';
}

function personBucketRequirement(person: PersonCohort): 'required' | 'forbidden' | 'optional' {
  if (person.metric === 'assigned') return 'required';
  return person.metric === 'completed' ? 'optional' : 'forbidden';
}

function validateCohort(cohort: AnalyticsDrilldownCohort): AnalyticsDrilldownCohort {
  const bucketed: ReadonlySet<string> = new Set([
    'delivery-created',
    'delivery-completed',
    'delivery-open',
  ]);
  const unbucketed: ReadonlySet<string> = new Set(
    ANALYTICS_OVERVIEW_COHORTS.filter((key) => !bucketed.has(key)),
  );
  if (bucketed.has(cohort.cohort)) {
    return validateBucketRequirement(cohort, 'required');
  }
  if (unbucketed.has(cohort.cohort)) {
    return validateBucketRequirement(cohort, 'forbidden');
  }
  const planning = planningCohort(cohort.cohort);
  if (planning !== null) {
    return validateBucketRequirement(cohort, planningBucketRequirement(planning));
  }
  const person = personCohort(cohort.cohort);
  if (person !== null) {
    return validateBucketRequirement(cohort, personBucketRequirement(person));
  }
  if (personGroupCohort(cohort.cohort) !== null) {
    return validateBucketRequirement(cohort, 'forbidden');
  }
  if (validDimensionCohort(cohort.cohort)) {
    return validateBucketRequirement(cohort, 'forbidden');
  }
  throw validationFailed('That analytics cohort is not supported.');
}

function openPredicate(): SQL {
  return sql`${schema.workflowState.category} not in ('completed', 'canceled')`;
}

function projectAddedPredicate(projectId: string, from: Date, to: Date): SQL<unknown> {
  return sql`(
    exists (
      select 1 from issue_activity project_activity
      where project_activity.issue_id = ${schema.issue.id}
        and project_activity.field = 'projectId'
        and coalesce(
          project_activity.to_value ->> 'id',
          project_activity.to_value #>> '{}'
        ) = ${projectId}
        and project_activity.created_at >= ${from.toISOString()}::timestamptz
        and project_activity.created_at < ${to.toISOString()}::timestamptz
    )
    or (
      ${schema.issue.createdAt} >= ${from.toISOString()}::timestamptz
      and ${schema.issue.createdAt} < ${to.toISOString()}::timestamptz
      and case when exists (
        select 1 from issue_activity project_history
        where project_history.issue_id = ${schema.issue.id}
          and project_history.field = 'projectId'
      ) then (
          select coalesce(first_project.from_value ->> 'id', first_project.from_value #>> '{}')
          from issue_activity first_project
          where first_project.issue_id = ${schema.issue.id}
            and first_project.field = 'projectId'
          order by first_project.created_at, first_project.id
          limit 1
        ) else ${schema.issue.projectId} end = ${projectId}
    )
  )`;
}

function bucketRange(resolved: ResolvedAnalyticsQuery, bucket: string): [Date, Date] {
  const starts = bucketDates(resolved.resolvedRange, resolved.bucket);
  const index = starts.findIndex((date) => calendarDateLabel(date, resolved.timezone) === bucket);
  if (index < 0) throw validationFailed('That analytics bucket is not valid.');
  const from = starts[index];
  if (from === undefined) throw validationFailed('That analytics bucket is not valid.');
  return [from, starts[index + 1] ?? resolved.to];
}

function projectRiskPredicate(
  resolved: ResolvedAnalyticsQuery,
  planning: ProjectCohort,
  projectId: SQL<unknown>,
): SQL<unknown> {
  switch (planning.metric) {
    case 'current':
      return projectId;
    case 'open':
      return and(projectId, openPredicate()) ?? sql`false`;
    case 'completed':
      return and(projectId, sql`${schema.workflowState.category} = 'completed'`) ?? sql`false`;
    case 'blocked':
      return (
        and(
          projectId,
          openPredicate(),
          sql`exists (
            select 1 from issue_relation project_risk_relation
            where project_risk_relation.issue_id = ${schema.issue.id}
              and project_risk_relation.type = 'blocked_by'
          )`,
        ) ?? sql`false`
      );
    case 'overdue':
      return (
        and(
          projectId,
          openPredicate(),
          isNotNull(schema.issue.dueDate),
          sql`${schema.issue.dueDate} < (${resolved.asOf.toISOString()}::timestamptz at time zone ${resolved.timezone})::date`,
        ) ?? sql`false`
      );
    case 'stale':
      return (
        and(
          projectId,
          openPredicate(),
          sql`${schema.issue.updatedAt} < ${new Date(
            resolved.asOf.getTime() - STALE_DAYS * 86_400_000,
          ).toISOString()}::timestamptz`,
        ) ?? sql`false`
      );
    case 'unestimated':
      return and(projectId, openPredicate(), isNull(schema.issue.estimate)) ?? sql`false`;
    case 'added':
      return projectAddedPredicate(planning.id, resolved.from, resolved.to);
    case 'completed-range':
      return (
        and(
          projectId,
          isNotNull(schema.issue.completedAt),
          sql`${schema.issue.completedAt} >= ${resolved.from.toISOString()}::timestamptz`,
          sql`${schema.issue.completedAt} < ${resolved.to.toISOString()}::timestamptz`,
        ) ?? sql`false`
      );
    default:
      return sql`false`;
  }
}

function projectDeliveryPredicate(
  resolved: ResolvedAnalyticsQuery,
  cohort: AnalyticsDrilldownCohort,
  planning: ProjectCohort,
  projectId: SQL<unknown>,
): SQL<unknown> {
  if (cohort.bucket === undefined) return sql`false`;
  const [from, to] = bucketRange(resolved, cohort.bucket);
  switch (planning.metric) {
    case 'delivery-scope':
      return (
        and(
          projectId,
          sql`${schema.issue.createdAt} < ${to.toISOString()}::timestamptz`,
          sql`(${schema.issue.canceledAt} is null or ${schema.issue.canceledAt} >= ${to.toISOString()}::timestamptz)`,
        ) ?? sql`false`
      );
    case 'delivery-started':
      return (
        and(
          projectId,
          isNotNull(schema.issue.startedAt),
          sql`${schema.issue.startedAt} < ${to.toISOString()}::timestamptz`,
        ) ?? sql`false`
      );
    case 'delivery-completed':
      return (
        and(
          projectId,
          isNotNull(schema.issue.completedAt),
          sql`${schema.issue.completedAt} < ${to.toISOString()}::timestamptz`,
        ) ?? sql`false`
      );
    case 'delivery-completed-bucket':
      return (
        and(
          projectId,
          isNotNull(schema.issue.completedAt),
          sql`${schema.issue.completedAt} >= ${from.toISOString()}::timestamptz`,
          sql`${schema.issue.completedAt} < ${to.toISOString()}::timestamptz`,
        ) ?? sql`false`
      );
    case 'delivery-open':
      return (
        and(
          projectId,
          sql`${schema.issue.createdAt} < ${to.toISOString()}::timestamptz`,
          sql`(${schema.issue.completedAt} is null or ${schema.issue.completedAt} >= ${to.toISOString()}::timestamptz)`,
          sql`(${schema.issue.canceledAt} is null or ${schema.issue.canceledAt} >= ${to.toISOString()}::timestamptz)`,
        ) ?? sql`false`
      );
    case 'delivery-added':
      return projectAddedPredicate(planning.id, from, to);
    default:
      return sql`false`;
  }
}

function planningCohortPredicate(
  resolved: ResolvedAnalyticsQuery,
  cohort: AnalyticsDrilldownCohort,
  planning: PlanningCohort,
): SQL<unknown> {
  if (planning.kind === 'milestone') {
    const milestoneId = eq(schema.issue.milestoneId, planning.id);
    return planning.metric === 'completed'
      ? (and(milestoneId, sql`${schema.workflowState.category} = 'completed'`) ?? sql`false`)
      : milestoneId;
  }
  const projectId = eq(schema.issue.projectId, planning.id);
  return planning.metric.startsWith('delivery-')
    ? projectDeliveryPredicate(resolved, cohort, planning, projectId)
    : projectRiskPredicate(resolved, planning, projectId);
}

function personSelection(query: AnalyticsQuery): string | null {
  if (query.focus.personId !== undefined) return query.focus.personId;
  const selected = selectedAssigneeIds(query);
  return selected.length === 1 ? (selected[0] ?? null) : null;
}

function currentPersonPredicate(personId: string): SQL<unknown> {
  return personId === UNASSIGNED_PERSON_ID
    ? isNull(schema.issue.assigneeId)
    : eq(schema.issue.assigneeId, personId);
}

function personGroupDimension(group: PersonGroupCohort): SQL<unknown> {
  switch (group.dimension) {
    case 'project':
      return eq(schema.issue.projectId, group.id);
    case 'milestone':
      return eq(schema.issue.milestoneId, group.id);
    case 'sprint':
      return eq(schema.issue.cycleId, group.id);
    case 'state':
      return eq(schema.issue.stateId, group.id);
  }
}

function personGroupPredicate(
  resolved: ResolvedAnalyticsQuery,
  group: PersonGroupCohort,
): SQL<unknown> {
  const personId = personSelection(resolved);
  if (personId === null) return sql`false`;
  const dimension = personGroupDimension(group);
  return and(currentPersonPredicate(personId), openPredicate(), dimension) ?? sql`false`;
}

function personCohortPredicate(
  resolved: ResolvedAnalyticsQuery,
  cohort: AnalyticsDrilldownCohort,
  person: PersonCohort,
): SQL<unknown> {
  const current = currentPersonPredicate(person.id);
  const attributed = personMatches(person.id, completionAttributionPerson());
  const completed = (): SQL<unknown> => {
    const range: readonly [Date, Date] =
      cohort.bucket === undefined
        ? [resolved.from, resolved.to]
        : bucketRange(resolved, cohort.bucket);
    const from = range[0];
    const to = range[1];
    return (
      and(
        attributed,
        isNotNull(schema.issue.completedAt),
        sql`${schema.issue.completedAt} >= ${from.toISOString()}::timestamptz`,
        sql`${schema.issue.completedAt} < ${to.toISOString()}::timestamptz`,
      ) ?? sql`false`
    );
  };
  switch (person.metric) {
    case 'current':
      return and(current, openPredicate()) ?? sql`false`;
    case 'completed':
      return completed();
    case 'wip':
      return (
        and(current, sql`${schema.workflowState.category} in ('started', 'review')`) ?? sql`false`
      );
    case 'blocked':
      return (
        and(
          current,
          openPredicate(),
          sql`exists (
            select 1 from issue_relation person_blocked
            where person_blocked.issue_id = ${schema.issue.id}
              and person_blocked.type = 'blocked_by'
          )`,
        ) ?? sql`false`
      );
    case 'overdue':
      return (
        and(
          current,
          openPredicate(),
          isNotNull(schema.issue.dueDate),
          sql`${schema.issue.dueDate} < (${resolved.asOf.toISOString()}::timestamptz at time zone ${resolved.timezone})::date`,
        ) ?? sql`false`
      );
    case 'stale':
      return (
        and(
          current,
          openPredicate(),
          sql`${schema.issue.updatedAt} < ${new Date(
            resolved.asOf.getTime() - STALE_DAYS * 86_400_000,
          ).toISOString()}::timestamptz`,
        ) ?? sql`false`
      );
    case 'unestimated':
      return and(current, openPredicate(), isNull(schema.issue.estimate)) ?? sql`false`;
    case 'assigned': {
      if (cohort.bucket === undefined) return sql`false`;
      const [from, to] = bucketRange(resolved, cohort.bucket);
      const activityPerson = sql`coalesce(
        person_assignment.to_value ->> 'id', person_assignment.to_value #>> '{}'
      )`;
      return sql`exists (
        select 1 from issue_activity person_assignment
        where person_assignment.issue_id = ${schema.issue.id}
          and person_assignment.field = 'assigneeId'
          and person_assignment.created_at >= ${from.toISOString()}::timestamptz
          and person_assignment.created_at < ${to.toISOString()}::timestamptz
          and ${personMatches(person.id, activityPerson)}
      )`;
    }
  }
}

function historicalPersonCohort(cohort: AnalyticsDrilldownCohort): boolean {
  const person = personCohort(cohort.cohort);
  return person?.metric === 'completed' || person?.metric === 'assigned';
}

function drilldownBase(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
  cohort: AnalyticsDrilldownCohort,
): SQL<unknown> {
  if (!historicalPersonCohort(cohort)) return baseAnalyticsPredicate(principal, resolved);
  const person = personCohort(cohort.cohort);
  if (person === null) return baseAnalyticsPredicate(principal, resolved);
  const historical = historicalPersonFilter(resolved, person.id);
  return sql`${baseAnalyticsPredicate(principal, historical.query)} and ${historical.matches}`;
}

export function cohortPredicate(
  resolved: ResolvedAnalyticsQuery,
  cohort: AnalyticsDrilldownCohort,
  base?: SQL<unknown>,
): SQL<unknown> {
  const planning = planningCohort(cohort.cohort);
  if (planning !== null) return planningCohortPredicate(resolved, cohort, planning);
  const person = personCohort(cohort.cohort);
  if (person !== null) return personCohortPredicate(resolved, cohort, person);
  const personGroup = personGroupCohort(cohort.cohort);
  if (personGroup !== null) return personGroupPredicate(resolved, personGroup);
  const dimension = dimensionCohortPredicate(resolved, cohort, base);
  if (dimension !== null) return dimension;
  const interval = (column: PgColumn): SQL =>
    and(
      sql`${column} >= ${resolved.from.toISOString()}::timestamptz`,
      sql`${column} < ${resolved.to.toISOString()}::timestamptz`,
    ) ?? sql`false`;
  const comparison = (column: PgColumn): SQL =>
    resolved.comparisonFrom === null || resolved.comparisonTo === null
      ? sql`false`
      : (and(
          sql`${column} >= ${resolved.comparisonFrom.toISOString()}::timestamptz`,
          sql`${column} < ${resolved.comparisonTo.toISOString()}::timestamptz`,
        ) ?? sql`false`);
  const bucketed = (column: PgColumn): SQL => {
    if (cohort.bucket === undefined) return interval(column);
    const [from, to] = bucketRange(resolved, cohort.bucket);
    return (
      and(
        sql`${column} >= ${from.toISOString()}::timestamptz`,
        sql`${column} < ${to.toISOString()}::timestamptz`,
      ) ?? sql`false`
    );
  };
  switch (cohort.cohort) {
    case 'current':
      return sql`true`;
    case 'created':
    case 'delivery-created':
      return bucketed(schema.issue.createdAt);
    case 'completed':
    case 'throughput':
    case 'delivery-completed':
      return (
        and(isNotNull(schema.issue.completedAt), bucketed(schema.issue.completedAt)) ?? sql`false`
      );
    case 'cycle-time':
      return (
        and(
          isNotNull(schema.issue.completedAt),
          isNotNull(schema.issue.startedAt),
          sql`${schema.issue.completedAt} >= ${schema.issue.startedAt}`,
          bucketed(schema.issue.completedAt),
        ) ?? sql`false`
      );
    case 'delivery-open': {
      if (cohort.bucket === undefined) return sql`false`;
      const [, to] = bucketRange(resolved, cohort.bucket);
      return (
        and(
          sql`${schema.issue.createdAt} < ${to.toISOString()}::timestamptz`,
          sql`(${schema.issue.completedAt} is null or ${schema.issue.completedAt} >= ${to.toISOString()}::timestamptz)`,
          sql`(${schema.issue.canceledAt} is null or ${schema.issue.canceledAt} > ${to.toISOString()}::timestamptz)`,
        ) ?? sql`false`
      );
    }
    case 'comparison-throughput':
      return (
        and(isNotNull(schema.issue.completedAt), comparison(schema.issue.completedAt)) ?? sql`false`
      );
    case 'wip':
      return sql`${schema.workflowState.category} in ('started', 'review')`;
    case 'blocked':
      return (
        and(
          openPredicate(),
          sql`exists (
          select 1 from issue_relation ir
          where ir.issue_id = ${schema.issue.id} and ir.type = 'blocked_by'
        )`,
        ) ?? sql`false`
      );
    case 'overdue':
      return (
        and(
          openPredicate(),
          isNotNull(schema.issue.dueDate),
          sql`${schema.issue.dueDate} < (${resolved.asOf.toISOString()}::timestamptz at time zone ${resolved.timezone})::date`,
        ) ?? sql`false`
      );
    case 'stale':
      return (
        and(
          openPredicate(),
          sql`${schema.issue.updatedAt} < ${new Date(
            resolved.asOf.getTime() - STALE_DAYS * 86_400_000,
          ).toISOString()}::timestamptz`,
        ) ?? sql`false`
      );
    case 'unestimated':
      return and(openPredicate(), isNull(schema.issue.estimate)) ?? sql`false`;
    default:
      throw validationFailed('That analytics cohort is not supported.');
  }
}

function predicateLabel(cohort: AnalyticsDrilldownCohort): string {
  return cohort.bucket === undefined ? cohort.cohort : `${cohort.cohort}:${cohort.bucket}`;
}

function cursorSecret(context: AnalyticsServiceContext): string {
  const secret = context.cursorSecret ?? process.env['BETTER_AUTH_SECRET'];
  if (secret === undefined || secret.length < 16) {
    throw validationFailed('Analytics pagination is not configured.');
  }
  return secret;
}

function cursorRequestBinding(
  principal: Principal,
  query: AnalyticsQuery,
  cohort: AnalyticsDrilldownCohort,
): string {
  return JSON.stringify({
    organizationId: principal.organizationId,
    query: {
      version: query.version,
      lens: query.lens,
      range: query.range,
      compare: query.compare,
      measure: query.measure,
      filter: query.filter,
      includeArchived: query.includeArchived,
      includeCanceled: query.includeCanceled,
      focus: query.focus,
    },
    cohort: cohort.cohort,
    bucket: cohort.bucket ?? null,
  });
}

function cursorResolution(resolved: ResolvedAnalyticsQuery): CursorResolution {
  return {
    asOf: resolved.asOf.toISOString(),
    from: resolved.from.toISOString(),
    to: resolved.to.toISOString(),
    comparisonFrom: resolved.comparisonFrom?.toISOString() ?? null,
    comparisonTo: resolved.comparisonTo?.toISOString() ?? null,
    timezone: resolved.timezone,
  };
}

function cursorSignature(body: string, binding: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(binding).update('.').update(body).digest();
}

function encodeCursor(
  row: PageRow,
  resolution: CursorResolution,
  binding: string,
  secret: string,
): string {
  const value: CursorValue = { id: row.id, resolution };
  const body = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${body}.${cursorSignature(body, binding, secret).toString('base64url')}`;
}

function cursorDate(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error('invalid');
  return value;
}

function nullableCursorDate(value: unknown): string | null {
  return value === null ? null : cursorDate(value);
}

function decodeCursor(cursor: string, binding: string, secret: string): CursorValue {
  try {
    const separator = cursor.indexOf('.');
    if (separator <= 0 || separator !== cursor.lastIndexOf('.')) throw new Error('invalid');
    const body = cursor.slice(0, separator);
    const signature = cursor.slice(separator + 1);
    const provided = Buffer.from(signature, 'base64url');
    const expected = cursorSignature(body, binding, secret);
    if (
      provided.toString('base64url') !== signature ||
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new Error('invalid');
    }
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('invalid');
    const value = parsed as Partial<CursorValue>;
    const resolution = value.resolution as Partial<CursorResolution> | undefined;
    if (
      typeof value.id !== 'string' ||
      !UUID_PATTERN.test(value.id) ||
      resolution === undefined ||
      typeof resolution.timezone !== 'string' ||
      resolution.timezone.length === 0 ||
      resolution.timezone.length > 64
    ) {
      throw new Error('invalid');
    }
    return {
      id: value.id,
      resolution: {
        asOf: cursorDate(resolution.asOf),
        from: cursorDate(resolution.from),
        to: cursorDate(resolution.to),
        comparisonFrom: nullableCursorDate(resolution.comparisonFrom),
        comparisonTo: nullableCursorDate(resolution.comparisonTo),
        timezone: resolution.timezone,
      },
    };
  } catch (cause) {
    throw validationFailed('That analytics page cursor is not valid.', { cause });
  }
}

export async function listAnalyticsDrilldown(
  principal: Principal,
  input: AnalyticsDrilldownInput,
  context: AnalyticsServiceContext = {},
): Promise<AnalyticsDrilldownPage> {
  assertCan(principal, 'analytics:read');
  const semanticCohort = validateCohort(input.cohort);
  const secret = cursorSecret(context);
  const binding = cursorRequestBinding(principal, input.query, semanticCohort);
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor, binding, secret);
  const resolutionContext =
    cursor === null
      ? context
      : {
          ...context,
          now: new Date(cursor.resolution.asOf),
          timezone: cursor.resolution.timezone,
        };
  const resolved = await resolveOverviewQuery(principal, input.query, resolutionContext);
  if (
    cursor !== null &&
    JSON.stringify(cursor.resolution) !== JSON.stringify(cursorResolution(resolved))
  ) {
    throw validationFailed('That analytics page cursor is not valid.');
  }
  const base = drilldownBase(principal, resolved, semanticCohort);
  const cohort = cohortPredicate(resolved, semanticCohort, base);
  const requestedLimit = input.limit ?? 50;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(requestedLimit)))
    : 50;
  const weight =
    resolved.measure === 'points' ? sql`coalesce(${schema.issue.estimate}, 0)` : sql`1`;
  const [aggregate] = await db.execute<AggregateRow>(sql`
    select
      count(*) as total,
      coalesce(sum(${weight}), 0) as total_value,
      count(*) filter (where ${schema.issue.completedAt} is not null
        and ${schema.issue.startedAt} is not null
        and ${schema.issue.completedAt} >= ${schema.issue.startedAt}) as valid_cycle_count,
      percentile_cont(0.5) within group (
        order by extract(epoch from (${schema.issue.completedAt} - ${schema.issue.startedAt})) / 86400
      ) filter (where ${schema.issue.completedAt} is not null and ${schema.issue.startedAt} is not null
        and ${schema.issue.completedAt} >= ${schema.issue.startedAt}) as cycle_time_p50,
      percentile_cont(0.85) within group (
        order by extract(epoch from (${schema.issue.completedAt} - ${schema.issue.startedAt})) / 86400
      ) filter (where ${schema.issue.completedAt} is not null and ${schema.issue.startedAt} is not null
        and ${schema.issue.completedAt} >= ${schema.issue.startedAt}) as cycle_time_p85
    from issue
    join workflow_state on workflow_state.id = issue.state_id
    where ${base} and ${cohort}
  `);
  const cursorPredicate = cursor === null ? sql`true` : gt(schema.issue.id, cursor.id);
  const rows = await db.execute<PageRow>(sql`
    select
      issue.id,
      issue.identifier,
      issue.title,
      issue.priority,
      issue.estimate,
      issue.due_date,
      issue.updated_at,
      issue.completed_at,
      case when issue.completed_at is not null and issue.started_at is not null
        and issue.completed_at >= issue.started_at
        then extract(epoch from (issue.completed_at - issue.started_at)) / 86400
        else null
      end as cycle_time_days,
      workflow_state.id as state_id,
      workflow_state.name as state_name,
      workflow_state.category as state_category,
      project.id as project_id,
      project.name as project_name,
      assignee.id as assignee_id,
      assignee.name as assignee_name,
      assignee.image as assignee_image
    from issue
    join workflow_state on workflow_state.id = issue.state_id
    left join project on project.id = issue.project_id
    left join "user" assignee on assignee.id = issue.assignee_id
    where ${base} and ${cohort} and ${cursorPredicate}
    order by issue.id asc
    limit ${limit + 1}
  `);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last !== undefined
      ? encodeCursor(last, cursorResolution(resolved), binding, secret)
      : null;
  return {
    predicate: predicateLabel(semanticCohort),
    total: Number(aggregate?.['total'] ?? 0),
    totalValue: Number(aggregate?.['total_value'] ?? 0),
    details: {
      validCycleCount: Number(aggregate?.['valid_cycle_count'] ?? 0),
      cycleTimeP50:
        aggregate?.['cycle_time_p50'] === null || aggregate?.['cycle_time_p50'] === undefined
          ? null
          : Number(aggregate['cycle_time_p50']),
      cycleTimeP85:
        aggregate?.['cycle_time_p85'] === null || aggregate?.['cycle_time_p85'] === undefined
          ? null
          : Number(aggregate['cycle_time_p85']),
    },
    issues: page.map((row) => ({
      id: row.id,
      identifier: row.identifier,
      title: row.title,
      priority: Number(row.priority),
      estimate: row.estimate === null ? null : Number(row.estimate),
      dueDate: row.due_date,
      updatedAt: new Date(row.updated_at).toISOString(),
      completedAt: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
      cycleTimeDays: row.cycle_time_days === null ? null : Number(row.cycle_time_days),
      state: { id: row.state_id, name: row.state_name, category: row.state_category },
      project:
        row.project_id === null || row.project_name === null
          ? null
          : { id: row.project_id, name: row.project_name },
      assignee:
        row.assignee_id === null || row.assignee_name === null
          ? null
          : { id: row.assignee_id, name: row.assignee_name, image: row.assignee_image },
    })),
    nextCursor,
    limit,
    asOf: resolved.asOf.toISOString(),
    from: resolved.from.toISOString(),
    to: resolved.to.toISOString(),
    timezone: resolved.timezone,
  };
}

export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority as Priority] ?? String(priority);
}
