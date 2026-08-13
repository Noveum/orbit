import { and, asc, db, eq, gt, isNotNull, isNull, schema, sql } from '@orbit/db';
import { PRIORITY_LABELS, type Priority } from '@orbit/shared/constants';
import { validationFailed } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import type { AnalyticsDrilldownCohort, AnalyticsQuery } from '@orbit/shared/validators';
import { issueFilterSchema } from '@orbit/shared/validators';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { buildIssueWhere } from '../work/issue-query.ts';
import { bucketDates, resolveAnalyticsQuery } from './filter.ts';
import type { AnalyticsResolutionContext, ResolvedAnalyticsQuery } from './types.ts';

const MAX_LIMIT = 200;
const STALE_DAYS = 14;

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

export type AnalyticsOverviewCohortKey =
  | (typeof ANALYTICS_OVERVIEW_COHORTS)[number]
  | `state:${string}`
  | `project:${string}`
  | `priority:${number}`
  | `outlier:${string}`;

export interface AnalyticsServiceContext {
  readonly now?: Date;
  readonly timezone?: string;
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
  readonly cycleTimeP50: number;
  readonly cycleTimeP85: number;
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
}

export interface AnalyticsDrilldownInput {
  readonly query: AnalyticsQuery;
  readonly cohort: AnalyticsDrilldownCohort;
  readonly cursor?: string;
  readonly limit?: number;
}

interface CursorValue {
  readonly cohort: string;
  readonly bucket: string | null;
  readonly id: string;
}

interface AggregateRow {
  readonly [key: string]: unknown;
  readonly total: number | string;
  readonly total_value: number | string;
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
      now: new Date(resolved.to.getTime() - 1),
    }),
  ];
  if (!resolved.includeCanceled) filters.push(sql`${schema.workflowState.category} <> 'canceled'`);
  return and(...filters) ?? sql`false`;
}

function openPredicate(): SQL {
  return sql`${schema.workflowState.category} not in ('completed', 'canceled')`;
}

function bucketRange(resolved: ResolvedAnalyticsQuery, bucket: string): [Date, Date] {
  const starts = bucketDates(resolved.resolvedRange, resolved.bucket);
  const index = starts.findIndex((date) => date.toISOString().slice(0, 10) === bucket);
  if (index < 0) throw validationFailed('That analytics bucket is not valid.');
  const from = starts[index];
  if (from === undefined) throw validationFailed('That analytics bucket is not valid.');
  return [from, starts[index + 1] ?? resolved.to];
}

export function cohortPredicate(
  resolved: ResolvedAnalyticsQuery,
  cohort: AnalyticsDrilldownCohort,
): SQL<unknown> {
  if (cohort.cohort.startsWith('state:')) {
    return eq(schema.issue.stateId, cohort.cohort.slice('state:'.length));
  }
  if (cohort.cohort.startsWith('project:')) {
    const projectId = cohort.cohort.slice('project:'.length);
    return projectId === 'none'
      ? isNull(schema.issue.projectId)
      : eq(schema.issue.projectId, projectId);
  }
  if (cohort.cohort.startsWith('priority:')) {
    return eq(schema.issue.priority, Number(cohort.cohort.slice('priority:'.length)));
  }
  if (cohort.cohort.startsWith('outlier:')) {
    return eq(schema.issue.id, cohort.cohort.slice('outlier:'.length));
  }
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

function encodeCursor(cohort: AnalyticsDrilldownCohort, row: PageRow): string {
  const value: CursorValue = {
    cohort: cohort.cohort,
    bucket: cohort.bucket ?? null,
    id: row.id,
  };
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, cohort: AnalyticsDrilldownCohort): CursorValue {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('invalid');
    const value = parsed as Partial<CursorValue>;
    if (
      value.cohort !== cohort.cohort ||
      value.bucket !== (cohort.bucket ?? null) ||
      typeof value.id !== 'string'
    ) {
      throw new Error('invalid');
    }
    return {
      cohort: value.cohort,
      bucket: value.bucket,
      id: value.id,
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
  const resolved = await resolveOverviewQuery(principal, input.query, context);
  const base = baseAnalyticsPredicate(principal, resolved);
  const cohort = cohortPredicate(resolved, input.cohort);
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
      coalesce(percentile_cont(0.5) within group (
        order by extract(epoch from (${schema.issue.completedAt} - ${schema.issue.startedAt})) / 86400
      ) filter (where ${schema.issue.completedAt} is not null and ${schema.issue.startedAt} is not null), 0) as cycle_time_p50,
      coalesce(percentile_cont(0.85) within group (
        order by extract(epoch from (${schema.issue.completedAt} - ${schema.issue.startedAt})) / 86400
      ) filter (where ${schema.issue.completedAt} is not null and ${schema.issue.startedAt} is not null), 0) as cycle_time_p85
    from issue
    join workflow_state on workflow_state.id = issue.state_id
    where ${base} and ${cohort}
  `);
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor, input.cohort);
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
    rows.length > limit && last !== undefined ? encodeCursor(input.cohort, last) : null;
  return {
    predicate: predicateLabel(input.cohort),
    total: Number(aggregate?.['total'] ?? 0),
    totalValue: Number(aggregate?.['total_value'] ?? 0),
    details: {
      cycleTimeP50: Number(aggregate?.['cycle_time_p50'] ?? 0),
      cycleTimeP85: Number(aggregate?.['cycle_time_p85'] ?? 0),
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
  };
}

export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority as Priority] ?? String(priority);
}
