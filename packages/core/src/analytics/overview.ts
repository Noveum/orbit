import { db, sql } from '@orbit/db';
import {
  STATE_CATEGORY_LABELS,
  STATE_CATEGORY_ORDER,
  type StateCategory,
} from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import type { AnalyticsDrilldownCohort, AnalyticsQuery } from '@orbit/shared/validators';
import {
  type AnalyticsServiceContext,
  baseAnalyticsPredicate,
  cohortPredicate,
  priorityLabel,
  resolveOverviewQuery,
} from './drilldown.ts';
import { bucketDates } from './filter.ts';
import type {
  AnalyticsBucket,
  AnalyticsCoverage,
  AnalyticsMetricUnit,
  ResolvedAnalyticsQuery,
} from './types.ts';

export const ANALYTICS_DISTRIBUTION_CAP = 8;

export type AnalyticsMetricDetail = 'cycleTimeP50' | 'cycleTimeP85';

export type AnalyticsMetricReconciliation =
  | { readonly kind: 'total'; readonly cohortCount: number }
  | {
      readonly kind: 'detail';
      readonly cohortCount: number;
      readonly detail: AnalyticsMetricDetail;
    };

export interface AnalyticsOverviewMetric {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: AnalyticsMetricUnit;
  readonly comparisonDelta: number | null;
  readonly cohort: AnalyticsDrilldownCohort;
  readonly reconciliation: AnalyticsMetricReconciliation;
}

export interface DeliveryPoint {
  readonly date: string;
  readonly created: number;
  readonly completed: number;
  readonly open: number;
  readonly createdCohort: AnalyticsDrilldownCohort;
  readonly completedCohort: AnalyticsDrilldownCohort;
  readonly openCohort: AnalyticsDrilldownCohort;
}

export interface FlowOutlier {
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
  readonly cycleTimeDays: number;
  readonly cohort: AnalyticsDrilldownCohort;
}

export interface AnalyticsOverview {
  readonly lens: 'overview';
  readonly asOf: string;
  readonly coverage: AnalyticsCoverage;
  readonly cards: readonly AnalyticsOverviewMetric[];
  readonly delivery: readonly DeliveryPoint[];
  readonly state: readonly AnalyticsBucket[];
  readonly projects: readonly AnalyticsBucket[];
  readonly priorities: readonly AnalyticsBucket[];
  readonly outliers: readonly FlowOutlier[];
}

interface CardRow {
  readonly [key: string]: unknown;
  readonly current_total: number | string;
  readonly current_value: number | string;
  readonly comparison_total: number | string;
  readonly comparison_value: number | string;
  readonly cycle_count: number | string;
  readonly cycle_p50: number | string | null;
  readonly cycle_p85: number | string | null;
  readonly comparison_cycle_p50: number | string | null;
  readonly comparison_cycle_p85: number | string | null;
  readonly comparison_cycle_count: number | string;
}

interface HealthRow {
  readonly [key: string]: unknown;
  readonly wip_total: number | string;
  readonly wip_value: number | string;
  readonly blocked_total: number | string;
  readonly blocked_value: number | string;
  readonly overdue_total: number | string;
  readonly overdue_value: number | string;
  readonly stale_total: number | string;
  readonly stale_value: number | string;
  readonly unestimated_total: number | string;
}

interface DistributionRow {
  readonly [key: string]: unknown;
  readonly dimension: 'state' | 'project' | 'priority';
  readonly id: string;
  readonly label: string;
  readonly value: number | string;
  readonly issue_count: number | string;
}

interface DeliveryRow {
  readonly [key: string]: unknown;
  readonly date: string;
  readonly created: number | string;
  readonly completed: number | string;
  readonly open: number | string;
}

interface OutlierRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly cycle_time_days: number | string;
}

function metric(
  input: Omit<AnalyticsOverviewMetric, 'reconciliation'> & {
    readonly cohortCount: number;
    readonly detail?: AnalyticsMetricDetail;
  },
): AnalyticsOverviewMetric {
  return {
    id: input.id,
    label: input.label,
    value: input.value,
    unit: input.unit,
    comparisonDelta: input.comparisonDelta,
    cohort: input.cohort,
    reconciliation:
      input.detail === undefined
        ? { kind: 'total', cohortCount: input.cohortCount }
        : { kind: 'detail', cohortCount: input.cohortCount, detail: input.detail },
  };
}

function amount(row: CardRow | undefined, key: keyof CardRow): number {
  return Number(row?.[key] ?? 0);
}

function optionalAmount(row: CardRow | undefined, key: keyof CardRow): number | null {
  const value = row?.[key];
  return value === null || value === undefined ? null : Number(value);
}

async function healthCards(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
): Promise<HealthRow> {
  const base = baseAnalyticsPredicate(principal, resolved);
  const weight = resolved.measure === 'points' ? sql`coalesce(issue.estimate, 0)` : sql`1`;
  const wip = cohortPredicate(resolved, { cohort: 'wip' });
  const blocked = cohortPredicate(resolved, { cohort: 'blocked' });
  const overdue = cohortPredicate(resolved, { cohort: 'overdue' });
  const stale = cohortPredicate(resolved, { cohort: 'stale' });
  const unestimated = cohortPredicate(resolved, { cohort: 'unestimated' });
  const [row] = await db.execute<HealthRow>(sql`
    select
      count(*) filter (where ${wip}) as wip_total,
      coalesce(sum(${weight}) filter (where ${wip}), 0) as wip_value,
      count(*) filter (where ${blocked}) as blocked_total,
      coalesce(sum(${weight}) filter (where ${blocked}), 0) as blocked_value,
      count(*) filter (where ${overdue}) as overdue_total,
      coalesce(sum(${weight}) filter (where ${overdue}), 0) as overdue_value,
      count(*) filter (where ${stale}) as stale_total,
      coalesce(sum(${weight}) filter (where ${stale}), 0) as stale_value,
      count(*) filter (where ${unestimated}) as unestimated_total
    from issue
    join workflow_state on workflow_state.id = issue.state_id
    where ${base}
  `);
  return (
    row ?? {
      wip_total: 0,
      wip_value: 0,
      blocked_total: 0,
      blocked_value: 0,
      overdue_total: 0,
      overdue_value: 0,
      stale_total: 0,
      stale_value: 0,
      unestimated_total: 0,
    }
  );
}

async function throughputCards(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
): Promise<CardRow> {
  const base = baseAnalyticsPredicate(principal, resolved);
  const current = cohortPredicate(resolved, { cohort: 'throughput' });
  const comparison = cohortPredicate(resolved, { cohort: 'comparison-throughput' });
  const weight = resolved.measure === 'points' ? sql`coalesce(issue.estimate, 0)` : sql`1`;
  const duration = sql`extract(epoch from (issue.completed_at - issue.started_at)) / 86400`;
  const validCycle = sql`issue.started_at is not null and issue.completed_at >= issue.started_at`;
  const [row] = await db.execute<CardRow>(sql`
    select
      count(*) filter (where ${current}) as current_total,
      coalesce(sum(${weight}) filter (where ${current}), 0) as current_value,
      count(*) filter (where ${comparison}) as comparison_total,
      coalesce(sum(${weight}) filter (where ${comparison}), 0) as comparison_value,
      count(*) filter (where ${current} and ${validCycle}) as cycle_count,
      count(*) filter (where ${comparison} and ${validCycle}) as comparison_cycle_count,
      coalesce(percentile_cont(0.5) within group (order by ${duration})
        filter (where ${current} and ${validCycle}), 0) as cycle_p50,
      coalesce(percentile_cont(0.85) within group (order by ${duration})
        filter (where ${current} and ${validCycle}), 0) as cycle_p85,
      percentile_cont(0.5) within group (order by ${duration})
        filter (where ${comparison} and ${validCycle}) as comparison_cycle_p50,
      percentile_cont(0.85) within group (order by ${duration})
        filter (where ${comparison} and ${validCycle}) as comparison_cycle_p85
    from issue
    join workflow_state on workflow_state.id = issue.state_id
    where ${base}
  `);
  return (
    row ?? {
      current_total: 0,
      current_value: 0,
      comparison_total: 0,
      comparison_value: 0,
      cycle_count: 0,
      comparison_cycle_count: 0,
      cycle_p50: 0,
      cycle_p85: 0,
      comparison_cycle_p50: null,
      comparison_cycle_p85: null,
    }
  );
}

async function distributions(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
): Promise<readonly DistributionRow[]> {
  const base = baseAnalyticsPredicate(principal, resolved);
  const weight = resolved.measure === 'points' ? sql`coalesce(issue.estimate, 0)` : sql`1`;
  return await db.execute<DistributionRow>(sql`
    with filtered as materialized (
      select workflow_state.category::text as state_id,
        workflow_state.category::text as state_name,
        coalesce(project.id, 'none') as project_id,
        coalesce(project.name, 'No project') as project_name,
        issue.priority::text as priority_id, ${weight} as weight
      from issue
      join workflow_state on workflow_state.id = issue.state_id
      left join project on project.id = issue.project_id
      where ${base}
    ), dimensioned as (
      select dimensions.dimension, dimensions.id, dimensions.label, filtered.weight
      from filtered
      cross join lateral (values
        ('state', filtered.state_id, filtered.state_name),
        ('project', filtered.project_id, filtered.project_name),
        ('priority', filtered.priority_id, filtered.priority_id)
      ) dimensions(dimension, id, label)
    ), grouped as (
      select dimension, id, label, sum(weight) as value, count(*) as issue_count
      from dimensioned
      group by dimension, id, label
    ), ranked as (
      select grouped.*,
        row_number() over (partition by dimension order by value desc, id asc) as rank
      from grouped
    ), collapsed as (
      select dimension,
        case when rank <= ${ANALYTICS_DISTRIBUTION_CAP} then id else 'other' end as id,
        case when rank <= ${ANALYTICS_DISTRIBUTION_CAP} then label else 'Other' end as label,
        value, issue_count
      from ranked
    )
    select dimension, id, label, sum(value) as value, sum(issue_count) as issue_count
    from collapsed
    group by dimension, id, label
    order by dimension, value desc, id asc
  `);
}

async function deliverySeries(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
): Promise<readonly DeliveryRow[]> {
  const base = baseAnalyticsPredicate(principal, resolved);
  const weight = resolved.measure === 'points' ? sql`coalesce(issue.estimate, 0)` : sql`1`;
  const starts = bucketDates(resolved.resolvedRange, resolved.bucket);
  const rows = starts.map((start, index) => {
    const end = starts[index + 1] ?? resolved.to;
    return sql`(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, ${start.toISOString().slice(0, 10)})`;
  });
  if (rows.length === 0) return [];
  return await db.execute<DeliveryRow>(sql`
    with buckets(bucket_start, bucket_end, date) as (values ${sql.join(rows, sql`, `)}),
    filtered as (
      select issue.* from issue
      join workflow_state on workflow_state.id = issue.state_id
      where ${base}
    )
    select buckets.date,
      coalesce(sum(${weight}) filter (
        where issue.created_at >= buckets.bucket_start and issue.created_at < buckets.bucket_end
      ), 0) as created,
      coalesce(sum(${weight}) filter (
        where issue.completed_at >= buckets.bucket_start and issue.completed_at < buckets.bucket_end
      ), 0) as completed,
      coalesce(sum(${weight}) filter (
        where issue.created_at < buckets.bucket_end
          and (issue.completed_at is null or issue.completed_at >= buckets.bucket_end)
          and (issue.canceled_at is null or issue.canceled_at > buckets.bucket_end)
      ), 0) as open
    from buckets
    left join filtered issue on issue.created_at < buckets.bucket_end
    group by buckets.bucket_start, buckets.date
    order by buckets.bucket_start
  `);
}

async function outliers(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
): Promise<readonly OutlierRow[]> {
  const base = baseAnalyticsPredicate(principal, resolved);
  const current = cohortPredicate(resolved, { cohort: 'cycle-time' });
  return await db.execute<OutlierRow>(sql`
    select issue.id, issue.identifier, issue.title,
      extract(epoch from (issue.completed_at - issue.started_at)) / 86400 as cycle_time_days
    from issue
    join workflow_state on workflow_state.id = issue.state_id
    where ${base} and ${current} and issue.started_at is not null
    order by cycle_time_days desc, issue.id asc
    limit 10
  `);
}

function distributionBucket(
  row: DistributionRow,
  measure: AnalyticsQuery['measure'],
): AnalyticsBucket {
  const id = row.dimension === 'priority' ? String(row.id) : row.id;
  let label = row.label;
  if (row.dimension === 'priority') label = priorityLabel(Number(row.id));
  if (row.dimension === 'state') label = STATE_CATEGORY_LABELS[row.id as StateCategory];
  return {
    id,
    label,
    value: Number(row.value),
    unit: measure,
    cohort: { cohort: `${row.dimension === 'state' ? 'state-category' : row.dimension}:${id}` },
  };
}

export async function loadAnalyticsOverview(
  principal: Principal,
  query: AnalyticsQuery,
  context: AnalyticsServiceContext = {},
): Promise<AnalyticsOverview> {
  const resolved = await resolveOverviewQuery(principal, query, context);
  const [throughput, health, mix, delivery, slow] = await Promise.all([
    throughputCards(principal, resolved),
    healthCards(principal, resolved),
    distributions(principal, resolved),
    deliverySeries(principal, resolved),
    outliers(principal, resolved),
  ]);
  const comparisonExists = resolved.comparisonRange !== null;
  const throughputValue = amount(throughput, 'current_value');
  const cycleP50 = amount(throughput, 'cycle_p50');
  const cycleP85 = amount(throughput, 'cycle_p85');
  const comparisonCycleP50 = optionalAmount(throughput, 'comparison_cycle_p50');
  const comparisonCycleP85 = optionalAmount(throughput, 'comparison_cycle_p85');
  const unit = resolved.measure;
  const cards: AnalyticsOverviewMetric[] = [
    metric({
      id: 'throughput',
      label: 'Completed in range',
      value: throughputValue,
      unit,
      comparisonDelta: comparisonExists
        ? throughputValue - amount(throughput, 'comparison_value')
        : null,
      cohort: { cohort: 'throughput' },
      cohortCount: amount(throughput, 'current_total'),
    }),
    metric({
      id: 'wip',
      label: 'Current WIP',
      value: Number(health.wip_value),
      unit,
      comparisonDelta: null,
      cohort: { cohort: 'wip' },
      cohortCount: Number(health.wip_total),
    }),
    metric({
      id: 'cycle_time_p50',
      label: 'Median cycle time',
      value: cycleP50,
      unit: 'days',
      comparisonDelta:
        comparisonExists && comparisonCycleP50 !== null ? cycleP50 - comparisonCycleP50 : null,
      cohort: { cohort: 'cycle-time' },
      cohortCount: amount(throughput, 'cycle_count'),
      detail: 'cycleTimeP50',
    }),
    metric({
      id: 'cycle_time_p85',
      label: 'Cycle time p85',
      value: cycleP85,
      unit: 'days',
      comparisonDelta:
        comparisonExists && comparisonCycleP85 !== null ? cycleP85 - comparisonCycleP85 : null,
      cohort: { cohort: 'cycle-time' },
      cohortCount: amount(throughput, 'cycle_count'),
      detail: 'cycleTimeP85',
    }),
    metric({
      id: 'blocked',
      label: 'Blocked work',
      value: Number(health.blocked_value),
      unit,
      comparisonDelta: null,
      cohort: { cohort: 'blocked' },
      cohortCount: Number(health.blocked_total),
    }),
    metric({
      id: 'overdue',
      label: 'Overdue work',
      value: Number(health.overdue_value),
      unit,
      comparisonDelta: null,
      cohort: { cohort: 'overdue' },
      cohortCount: Number(health.overdue_total),
    }),
    metric({
      id: 'stale',
      label: 'Stale work',
      value: Number(health.stale_value),
      unit,
      comparisonDelta: null,
      cohort: { cohort: 'stale' },
      cohortCount: Number(health.stale_total),
    }),
    metric({
      id: 'unestimated',
      label: 'Unestimated work',
      value: Number(health.unestimated_total),
      unit: 'issues',
      comparisonDelta: null,
      cohort: { cohort: 'unestimated' },
      cohortCount: Number(health.unestimated_total),
    }),
  ];
  return {
    lens: 'overview',
    asOf: resolved.asOf.toISOString(),
    coverage: { kind: 'live', from: null, asOf: resolved.asOf.toISOString() },
    cards,
    delivery: delivery.map((row) => ({
      date: row.date,
      created: Number(row.created),
      completed: Number(row.completed),
      open: Number(row.open),
      createdCohort: { cohort: 'delivery-created', bucket: row.date },
      completedCohort: { cohort: 'delivery-completed', bucket: row.date },
      openCohort: { cohort: 'delivery-open', bucket: row.date },
    })),
    state: mix
      .filter((row) => row.dimension === 'state')
      .map((row) => distributionBucket(row, unit))
      .sort(
        (left, right) =>
          STATE_CATEGORY_ORDER[left.id as StateCategory] -
          STATE_CATEGORY_ORDER[right.id as StateCategory],
      ),
    projects: mix
      .filter((row) => row.dimension === 'project')
      .map((row) => distributionBucket(row, unit)),
    priorities: mix
      .filter((row) => row.dimension === 'priority')
      .map((row) => distributionBucket(row, unit)),
    outliers: slow.map((row) => ({
      issueId: row.id,
      identifier: row.identifier,
      title: row.title,
      cycleTimeDays: Number(row.cycle_time_days),
      cohort: { cohort: `outlier:${row.id}` },
    })),
  };
}
