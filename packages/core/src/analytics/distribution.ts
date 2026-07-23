import { db, sql } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import type { SQL } from 'drizzle-orm';
import type { AnalyticsScope, ChartDimension, Measure } from './schemas.ts';

type JoinKind = 'state' | 'assignee' | 'project' | 'label' | 'cycle';

interface AxisDef {
  readonly key: SQL;
  readonly label: SQL;
  readonly join: JoinKind | null;
}

const AXIS: Record<ChartDimension, AxisDef> = {
  state: {
    key: sql`coalesce(ws.id, 'none')`,
    label: sql`coalesce(ws.name, 'No state')`,
    join: 'state',
  },
  state_group: {
    key: sql`coalesce(ws.category, 'backlog')`,
    label: sql`coalesce(ws.category, 'backlog')`,
    join: 'state',
  },
  assignee: {
    key: sql`coalesce(u.id, 'none')`,
    label: sql`coalesce(u.name, 'Unassigned')`,
    join: 'assignee',
  },
  project: {
    key: sql`coalesce(p.id, 'none')`,
    label: sql`coalesce(p.name, 'No project')`,
    join: 'project',
  },
  label: {
    key: sql`coalesce(l.id, 'none')`,
    label: sql`coalesce(l.name, 'No label')`,
    join: 'label',
  },
  priority: {
    key: sql`i.priority::text`,
    label: sql`i.priority::text`,
    join: null,
  },
  estimate: {
    key: sql`coalesce(i.estimate, 0)::text`,
    label: sql`coalesce(i.estimate, 0)::text`,
    join: null,
  },
  cycle: {
    key: sql`coalesce(cy.id, 'none')`,
    label: sql`coalesce(nullif(cy.name, ''), 'Cycle ' || cy.number::text)`,
    join: 'cycle',
  },
  created_month: {
    key: sql`coalesce(to_char(date_trunc('month', i.created_at), 'YYYY-MM'), 'none')`,
    label: sql`coalesce(to_char(date_trunc('month', i.created_at), 'YYYY-MM'), 'Unknown')`,
    join: null,
  },
  completed_month: {
    key: sql`coalesce(to_char(date_trunc('month', i.completed_at), 'YYYY-MM'), 'none')`,
    label: sql`coalesce(to_char(date_trunc('month', i.completed_at), 'YYYY-MM'), 'Open')`,
    join: null,
  },
};

const JOIN_SQL: Record<JoinKind, SQL> = {
  state: sql`left join workflow_state ws on ws.id = i.state_id`,
  assignee: sql`left join "user" u on u.id = i.assignee_id`,
  project: sql`left join project p on p.id = i.project_id`,
  label: sql`left join issue_label il on il.issue_id = i.id left join label l on l.id = il.label_id`,
  cycle: sql`left join cycle cy on cy.id = i.cycle_id`,
};

const JOIN_ORDER: readonly JoinKind[] = ['state', 'assignee', 'project', 'label', 'cycle'];

function joinClause(dimensions: readonly (ChartDimension | undefined)[]): SQL {
  const joins = new Set<JoinKind>();
  for (const dimension of dimensions) {
    if (dimension === undefined) continue;
    const join = AXIS[dimension].join;
    if (join !== null) joins.add(join);
  }
  const fragments = JOIN_ORDER.filter((join) => joins.has(join)).map((join) => JOIN_SQL[join]);
  return fragments.length === 0 ? sql`` : sql.join(fragments, sql` `);
}

function scopeClause(principal: Principal, scope: AnalyticsScope): SQL {
  const base = sql`i.organization_id = ${principal.organizationId} and i.archived_at is null`;
  switch (scope.type) {
    case 'team':
      return sql`${base} and i.team_id = ${scope.id}`;
    case 'project':
      return sql`${base} and i.project_id = ${scope.id}`;
    case 'cycle':
      return sql`${base} and i.cycle_id = ${scope.id}`;
    default:
      return base;
  }
}

function measureClause(measure: Measure): SQL {
  return measure === 'points'
    ? sql`coalesce(sum(coalesce(i.estimate, 0)), 0)`
    : sql`count(distinct i.id)`;
}

export interface ChartDatum {
  readonly key: string;
  readonly name: string;
  readonly total: number;
  readonly values: Record<string, number>;
}

export interface ChartResult {
  readonly xAxis: ChartDimension;
  readonly segment: ChartDimension | null;
  readonly measure: Measure;
  readonly measureLabel: string;
  readonly schema: Record<string, string>;
  readonly data: ChartDatum[];
}

const MEASURE_LABEL: Record<Measure, string> = { issues: 'Issues', points: 'Points' };

export interface ChartInput {
  readonly scope: AnalyticsScope;
  readonly xAxis: ChartDimension;
  readonly segment?: ChartDimension | undefined;
  readonly measure: Measure;
}

type FlatRow = {
  readonly key: string;
  readonly name: string;
  readonly value: number | string;
};

type PivotRow = FlatRow & {
  readonly seg_key: string;
  readonly seg_name: string;
};

export async function buildChart(principal: Principal, input: ChartInput): Promise<ChartResult> {
  assertCan(principal, 'project:read');
  const axis = AXIS[input.xAxis];
  const value = measureClause(input.measure);
  const where = scopeClause(principal, input.scope);
  const measureLabel = MEASURE_LABEL[input.measure];

  if (input.segment === undefined) {
    const joins = joinClause([input.xAxis]);
    const rows = await db.execute<FlatRow>(sql`
      select ${axis.key} as key, ${axis.label} as name, ${value} as value
      from issue i
      ${joins}
      where ${where}
      group by ${axis.key}, ${axis.label}
      order by ${value} desc
    `);
    const data: ChartDatum[] = rows.map((row) => {
      const total = Number(row['value']);
      return {
        key: String(row['key']),
        name: String(row['name']),
        total,
        values: { value: total },
      };
    });
    return {
      xAxis: input.xAxis,
      segment: null,
      measure: input.measure,
      measureLabel,
      schema: { value: measureLabel },
      data,
    };
  }

  const seg = AXIS[input.segment];
  const joins = joinClause([input.xAxis, input.segment]);
  const rows = await db.execute<PivotRow>(sql`
    select
      ${axis.key} as key,
      ${axis.label} as name,
      ${seg.key} as seg_key,
      ${seg.label} as seg_name,
      ${value} as value
    from issue i
    ${joins}
    where ${where}
    group by ${axis.key}, ${axis.label}, ${seg.key}, ${seg.label}
  `);

  const byKey = new Map<
    string,
    { key: string; name: string; total: number; values: Record<string, number> }
  >();
  const segmentLabels: Record<string, string> = {};
  for (const row of rows) {
    const key = String(row['key']);
    const segKey = String(row['seg_key']);
    segmentLabels[segKey] = String(row['seg_name']);
    const amount = Number(row['value']);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        key,
        name: String(row['name']),
        total: amount,
        values: { [segKey]: amount },
      });
    } else {
      existing.values[segKey] = (existing.values[segKey] ?? 0) + amount;
      existing.total += amount;
    }
  }

  const data = [...byKey.values()].sort((left, right) => right.total - left.total);
  return {
    xAxis: input.xAxis,
    segment: input.segment,
    measure: input.measure,
    measureLabel,
    schema: segmentLabels,
    data,
  };
}

export interface DistributionSlice {
  readonly key: string;
  readonly name: string;
  readonly value: number;
}

export async function workDistribution(
  principal: Principal,
  scope: AnalyticsScope,
  dimension: ChartDimension,
  measure: Measure = 'issues',
): Promise<DistributionSlice[]> {
  const chart = await buildChart(principal, { scope, xAxis: dimension, measure });
  return chart.data.map((datum) => ({ key: datum.key, name: datum.name, value: datum.total }));
}

export function stateGroupBreakdown(
  principal: Principal,
  scope: AnalyticsScope,
  dimension: 'assignee' | 'project' | 'label',
  measure: Measure = 'issues',
): Promise<ChartResult> {
  return buildChart(principal, { scope, xAxis: dimension, segment: 'state_group', measure });
}

export interface ScopePoint {
  readonly date: string;
  readonly scope: number;
  readonly completed: number;
}

type ScopeRow = {
  readonly date: string;
  readonly scope: number | string;
  readonly completed: number | string;
};

export async function scopeSeries(
  principal: Principal,
  scope: AnalyticsScope,
  measure: Measure = 'issues',
  bucket: 'day' | 'week' = 'week',
): Promise<ScopePoint[]> {
  assertCan(principal, 'project:read');
  const where = scopeClause(principal, scope);
  const weight = measure === 'points' ? sql`coalesce(i.estimate, 0)` : sql`1`;
  const step = bucket === 'day' ? sql`interval '1 day'` : sql`interval '1 week'`;

  const rows = await db.execute<ScopeRow>(sql`
    with bounds as (
      select
        min(i.created_at) as first_at,
        max(greatest(i.created_at, coalesce(i.completed_at, i.created_at))) as last_at
      from issue i
      where ${where}
    ),
    buckets as (
      select generate_series(
        date_trunc(${bucket}, b.first_at),
        date_trunc(${bucket}, coalesce(b.last_at, b.first_at)),
        ${step}
      ) as bucket
      from bounds b
      where b.first_at is not null
    ),
    added as (
      select date_trunc(${bucket}, i.created_at) as bucket, sum(${weight}) as amount
      from issue i where ${where} group by 1
    ),
    finished as (
      select date_trunc(${bucket}, i.completed_at) as bucket, sum(${weight}) as amount
      from issue i where ${where} and i.completed_at is not null group by 1
    )
    select
      to_char(b.bucket, 'YYYY-MM-DD') as date,
      coalesce(sum(coalesce(a.amount, 0)) over (order by b.bucket), 0) as scope,
      coalesce(sum(coalesce(f.amount, 0)) over (order by b.bucket), 0) as completed
    from buckets b
    left join added a on a.bucket = b.bucket
    left join finished f on f.bucket = b.bucket
    order by b.bucket
  `);

  return rows.map((row) => ({
    date: String(row['date']),
    scope: Number(row['scope']),
    completed: Number(row['completed']),
  }));
}

export function projectProgressSeries(
  principal: Principal,
  projectId: string,
  measure: Measure = 'issues',
): Promise<ScopePoint[]> {
  return scopeSeries(principal, { type: 'project', id: projectId }, measure, 'week');
}
