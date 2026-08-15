import { and, db, isNotNull, schema, sql } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import type {
  AnalyticsDrilldownCohort,
  AnalyticsQuery,
  InsightConfig,
  InsightSlice,
} from '@orbit/shared/validators';
import type { SQL } from 'drizzle-orm';
import { baseAnalyticsPredicate, priorityLabel, resolveOverviewQuery } from './drilldown.ts';
import { type InsightPercentiles, percentilesOf } from './math.ts';
import type { ResolvedAnalyticsQuery } from './types.ts';

const SLICE_CAP = 30;
const SEGMENT_CAP = 8;
const SCATTER_CAP = 500;

export interface InsightSegmentValue {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

export interface InsightBucket {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly segments: readonly InsightSegmentValue[];
  readonly cohort: AnalyticsDrilldownCohort;
}

export interface InsightScatterPoint {
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
  readonly days: number;
}

export type InsightResult =
  | {
      readonly kind: 'bars';
      readonly unit: 'issues' | 'points';
      readonly buckets: readonly InsightBucket[];
    }
  | {
      readonly kind: 'scatter';
      readonly unit: 'days';
      readonly points: readonly InsightScatterPoint[];
      readonly percentiles: InsightPercentiles | null;
    };

interface SliceDimension {
  readonly id: SQL<unknown>;
  readonly label: SQL<unknown>;
  readonly cohortPrefix: string;
}

const SLICE_SQL: Record<InsightSlice, SliceDimension> = {
  assignee: {
    id: sql`coalesce(${schema.issue.assigneeId}, 'none')`,
    label: sql`coalesce("user".name, 'Unassigned')`,
    cohortPrefix: 'assignee',
  },
  state: {
    id: sql`${schema.issue.stateId}`,
    label: sql`workflow_state.name`,
    cohortPrefix: 'state',
  },
  state_category: {
    id: sql`workflow_state.category::text`,
    label: sql`workflow_state.category::text`,
    cohortPrefix: 'state-category',
  },
  project: {
    id: sql`coalesce(${schema.issue.projectId}, 'none')`,
    label: sql`coalesce(project.name, 'No project')`,
    cohortPrefix: 'project',
  },
  label: {
    id: sql`coalesce(issue_label.label_id, 'none')`,
    label: sql`coalesce(label.name, 'No label')`,
    cohortPrefix: 'label',
  },
  priority: {
    id: sql`${schema.issue.priority}::text`,
    label: sql`${schema.issue.priority}::text`,
    cohortPrefix: 'priority',
  },
  sprint: {
    id: sql`coalesce(${schema.issue.cycleId}, 'none')`,
    label: sql`coalesce(cycle.name, 'No sprint')`,
    cohortPrefix: 'sprint',
  },
  created_week: {
    id: sql`to_char(date_trunc('week', ${schema.issue.createdAt}), 'YYYY-MM-DD')`,
    label: sql`to_char(date_trunc('week', ${schema.issue.createdAt}), 'YYYY-MM-DD')`,
    cohortPrefix: 'created-week',
  },
  completed_week: {
    id: sql`to_char(date_trunc('week', ${schema.issue.completedAt}), 'YYYY-MM-DD')`,
    label: sql`to_char(date_trunc('week', ${schema.issue.completedAt}), 'YYYY-MM-DD')`,
    cohortPrefix: 'completed-week',
  },
};

type JoinKind = 'user' | 'project' | 'cycle' | 'label';

const JOIN_SQL: Record<JoinKind, SQL<unknown>> = {
  user: sql`left join "user" on "user".id = ${schema.issue.assigneeId}`,
  project: sql`left join project on project.id = ${schema.issue.projectId}`,
  cycle: sql`left join cycle on cycle.id = ${schema.issue.cycleId}`,
  label: sql`left join issue_label on issue_label.issue_id = ${schema.issue.id} left join label on label.id = issue_label.label_id`,
};

const JOIN_ORDER: readonly JoinKind[] = ['user', 'project', 'cycle', 'label'];

const SLICE_JOIN: Partial<Record<InsightSlice, JoinKind>> = {
  assignee: 'user',
  project: 'project',
  sprint: 'cycle',
  label: 'label',
};

function joinsFor(insight: InsightConfig): SQL<unknown> {
  const joins = new Set<JoinKind>();
  const sliceJoin = SLICE_JOIN[insight.slice];
  if (sliceJoin !== undefined) joins.add(sliceJoin);
  if (insight.segment !== undefined) {
    const segmentJoin = SLICE_JOIN[insight.segment];
    if (segmentJoin !== undefined) joins.add(segmentJoin);
  }
  const fragments = JOIN_ORDER.filter((join) => joins.has(join)).map((join) => JOIN_SQL[join]);
  return fragments.length === 0 ? sql`` : sql.join(fragments, sql` `);
}

function usesCompletedWeek(insight: InsightConfig): boolean {
  return insight.slice === 'completed_week' || insight.segment === 'completed_week';
}

interface BarRow {
  readonly [key: string]: unknown;
  readonly slice_id: string;
  readonly slice_label: string;
  readonly segment_id: string | null;
  readonly segment_label: string | null;
  readonly value: number | string;
}

async function barsRows(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
  insight: InsightConfig,
): Promise<readonly BarRow[]> {
  const base = baseAnalyticsPredicate(principal, resolved);
  const sliceDef = SLICE_SQL[insight.slice];
  const segmentDef = insight.segment === undefined ? null : SLICE_SQL[insight.segment];
  const segmentIdSql = segmentDef === null ? sql`null::text` : segmentDef.id;
  const segmentLabelSql = segmentDef === null ? sql`null::text` : segmentDef.label;
  const weight = insight.measure === 'points' ? sql`coalesce(${schema.issue.estimate}, 1)` : sql`1`;
  const filters: SQL<unknown>[] = [base];
  if (usesCompletedWeek(insight)) filters.push(isNotNull(schema.issue.completedAt));
  const where = and(...filters) ?? sql`false`;
  return await db.execute<BarRow>(sql`
    select
      ${sliceDef.id} as slice_id,
      ${sliceDef.label} as slice_label,
      ${segmentIdSql} as segment_id,
      ${segmentLabelSql} as segment_label,
      sum(${weight}) as value
    from issue
    join workflow_state on workflow_state.id = issue.state_id
    ${joinsFor(insight)}
    where ${where}
    group by ${sliceDef.id}, ${sliceDef.label}, ${segmentIdSql}, ${segmentLabelSql}
    order by value desc
  `);
}

interface SegmentAccumulator {
  readonly label: string;
  value: number;
}

interface SliceAccumulator {
  readonly id: string;
  readonly label: string;
  value: number;
  readonly segments: Map<string, SegmentAccumulator>;
}

function accumulateBars(rows: readonly BarRow[]): Map<string, SliceAccumulator> {
  const slices = new Map<string, SliceAccumulator>();
  for (const row of rows) {
    const value = Number(row.value);
    let slice = slices.get(row.slice_id);
    if (slice === undefined) {
      slice = { id: row.slice_id, label: row.slice_label, value: 0, segments: new Map() };
      slices.set(row.slice_id, slice);
    }
    slice.value += value;
    if (row.segment_id !== null) {
      const segmentLabel = row.segment_label ?? row.segment_id;
      const segment = slice.segments.get(row.segment_id);
      if (segment === undefined) {
        slice.segments.set(row.segment_id, { label: segmentLabel, value });
      } else {
        segment.value += value;
      }
    }
  }
  return slices;
}

function rankByValue<T extends { readonly value: number }>(
  entries: ReadonlyMap<string, T>,
): readonly (readonly [string, T])[] {
  return [...entries.entries()].sort(
    (left, right) => right[1].value - left[1].value || left[0].localeCompare(right[0]),
  );
}

function resolveLabel(kind: InsightSlice, id: string, rawLabel: string): string {
  if (id === 'other') return rawLabel;
  return kind === 'priority' ? priorityLabel(Number(id)) : rawLabel;
}

function capSegments(
  segments: ReadonlyMap<string, SegmentAccumulator>,
  kind: InsightSlice,
): readonly InsightSegmentValue[] {
  const ranked = rankByValue(segments);
  const kept = ranked.slice(0, SEGMENT_CAP).map(([id, segment]) => ({
    id,
    label: resolveLabel(kind, id, segment.label),
    value: segment.value,
  }));
  const overflow = ranked.slice(SEGMENT_CAP);
  if (overflow.length === 0) return kept;
  const overflowValue = overflow.reduce((sum, [, segment]) => sum + segment.value, 0);
  return [...kept, { id: 'other', label: 'Other', value: overflowValue }];
}

function mergeSegmentMaps(
  maps: readonly ReadonlyMap<string, SegmentAccumulator>[],
): Map<string, SegmentAccumulator> {
  const merged = new Map<string, SegmentAccumulator>();
  for (const map of maps) {
    for (const [id, segment] of map) {
      const existing = merged.get(id);
      if (existing === undefined) {
        merged.set(id, { label: segment.label, value: segment.value });
      } else {
        existing.value += segment.value;
      }
    }
  }
  return merged;
}

function buildBuckets(insight: InsightConfig, rows: readonly BarRow[]): readonly InsightBucket[] {
  const slices = accumulateBars(rows);
  const ranked = rankByValue(slices);
  const kept = ranked.slice(0, SLICE_CAP);
  const overflow = ranked.slice(SLICE_CAP);
  const cohortPrefix = SLICE_SQL[insight.slice].cohortPrefix;
  const buckets: InsightBucket[] = kept.map(([id, slice]) => ({
    id,
    label: resolveLabel(insight.slice, id, slice.label),
    value: slice.value,
    segments: insight.segment === undefined ? [] : capSegments(slice.segments, insight.segment),
    cohort: { cohort: `${cohortPrefix}:${id}` },
  }));
  if (overflow.length > 0) {
    const overflowValue = overflow.reduce((sum, [, slice]) => sum + slice.value, 0);
    const mergedSegments = mergeSegmentMaps(overflow.map(([, slice]) => slice.segments));
    buckets.push({
      id: 'other',
      label: 'Other',
      value: overflowValue,
      segments: insight.segment === undefined ? [] : capSegments(mergedSegments, insight.segment),
      cohort: { cohort: `${cohortPrefix}:other` },
    });
  }
  return buckets;
}

async function loadBars(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
  insight: InsightConfig,
): Promise<InsightResult> {
  const rows = await barsRows(principal, resolved, insight);
  return {
    kind: 'bars',
    unit: insight.measure === 'points' ? 'points' : 'issues',
    buckets: buildBuckets(insight, rows),
  };
}

type ScatterMeasure = 'cycle_time' | 'lead_time' | 'age';

function scatterDuration(measure: ScatterMeasure, resolved: ResolvedAnalyticsQuery): SQL<unknown> {
  switch (measure) {
    case 'cycle_time':
      return sql`extract(epoch from (${schema.issue.completedAt} - ${schema.issue.startedAt})) / 86400`;
    case 'lead_time':
      return sql`extract(epoch from (${schema.issue.completedAt} - ${schema.issue.createdAt})) / 86400`;
    case 'age':
      return sql`extract(epoch from (${resolved.asOf.toISOString()}::timestamptz - ${schema.issue.createdAt})) / 86400`;
  }
}

function scatterWhere(measure: ScatterMeasure, base: SQL<unknown>): SQL<unknown> {
  const filters: SQL<unknown>[] = [base];
  if (measure === 'cycle_time') {
    filters.push(isNotNull(schema.issue.startedAt), isNotNull(schema.issue.completedAt));
  } else if (measure === 'lead_time') {
    filters.push(isNotNull(schema.issue.completedAt));
  } else {
    filters.push(sql`workflow_state.category not in ('completed', 'canceled')`);
  }
  return and(...filters) ?? sql`false`;
}

interface DurationRow {
  readonly [key: string]: unknown;
  readonly days: number | string;
}

interface ScatterRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly days: number | string;
}

async function loadScatter(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
  measure: ScatterMeasure,
): Promise<InsightResult> {
  const base = baseAnalyticsPredicate(principal, resolved);
  const duration = scatterDuration(measure, resolved);
  const where = scatterWhere(measure, base);
  const [durations, points] = await Promise.all([
    db.execute<DurationRow>(sql`
      select ${duration} as days
      from issue
      join workflow_state on workflow_state.id = issue.state_id
      where ${where}
    `),
    db.execute<ScatterRow>(sql`
      select issue.id, issue.identifier, issue.title, ${duration} as days
      from issue
      join workflow_state on workflow_state.id = issue.state_id
      where ${where}
      order by days desc
      limit ${SCATTER_CAP}
    `),
  ]);
  return {
    kind: 'scatter',
    unit: 'days',
    points: points.map((row) => ({
      issueId: row.id,
      identifier: row.identifier,
      title: row.title,
      days: Number(row.days),
    })),
    percentiles: percentilesOf(durations.map((row) => Number(row.days))),
  };
}

export async function loadAnalyticsInsights(
  principal: Principal,
  query: AnalyticsQuery,
  insight: InsightConfig,
  context: { readonly now: Date; readonly timezone?: string },
): Promise<InsightResult> {
  assertCan(principal, 'analytics:read');
  const resolved = await resolveOverviewQuery(principal, query, context);
  if (insight.measure === 'count' || insight.measure === 'points') {
    return loadBars(principal, resolved, insight);
  }
  return loadScatter(principal, resolved, insight.measure);
}
