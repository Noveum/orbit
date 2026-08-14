import { and, asc, db, eq, schema, sql } from '@orbit/db';
import { analyticsQuerySchema } from '@orbit/shared';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { sprintLabel } from '@orbit/shared/utils';
import type { SQL } from 'drizzle-orm';
import { requireRow } from '../internal.ts';
import { calendarDateLabel } from './filter.ts';
import { churnFromScopeSeries, type Distribution, distributionOf, idealRemaining } from './math.ts';
import type { Measure } from './schemas.ts';
import { loadSprintAnalytics } from './sprints.ts';

function weightSql(measure: Measure): SQL {
  return measure === 'points' ? sql`coalesce(estimate, 0)` : sql`1`;
}

function nextCalendarDay(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export interface BurndownPoint {
  readonly date: string;
  readonly scope: number;
  readonly completed: number | null;
  readonly remaining: number | null;
  readonly ideal: number;
  readonly isFuture: boolean;
}

export interface CycleBurndown {
  readonly cycleId: string;
  readonly name: string;
  readonly measure: Measure;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly scopeStart: number;
  readonly scopeCurrent: number;
  readonly completedCurrent: number;
  readonly points: BurndownPoint[];
}

async function loadCycle(principal: Principal, cycleId: string) {
  const [row] = await db
    .select()
    .from(schema.cycle)
    .where(
      and(eq(schema.cycle.id, cycleId), eq(schema.cycle.organizationId, principal.organizationId)),
    )
    .limit(1);
  return requireRow(row, 'That cycle does not exist.');
}

export async function cycleBurndown(
  principal: Principal,
  cycleId: string,
  measure: Measure = 'issues',
  now: Date = new Date(),
): Promise<CycleBurndown> {
  await loadCycle(principal, cycleId);
  const analytics = await loadSprintAnalytics(
    principal,
    analyticsQuerySchema.parse({
      lens: 'sprints',
      measure,
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'cycle',
            operator: 'in',
            values: [cycleId],
            negate: false,
          },
        ],
      },
    }),
    { now, selectedSprintId: cycleId },
  );
  if (analytics.current === null) throw new Error('The selected sprint is unavailable.');
  const cycle = analytics.current.sprint;
  const today = calendarDateLabel(now, cycle.timezone);
  const actual = analytics.current.burn;
  const points: BurndownPoint[] = [];
  const finalDay = calendarDateLabel(new Date(cycle.endsAt), cycle.timezone);
  for (
    let day = calendarDateLabel(new Date(cycle.startsAt), cycle.timezone);
    day <= finalDay;
    day = nextCalendarDay(day)
  ) {
    const found = actual.find((point) => point.date === day);
    const isFuture = day > today || found === undefined;
    points.push({
      date: day,
      scope: found?.scope ?? actual.at(-1)?.scope ?? 0,
      completed: isFuture ? null : (found?.completed ?? 0),
      remaining: isFuture ? null : (found?.remaining ?? 0),
      ideal: found?.ideal ?? actual.at(-1)?.ideal ?? 0,
      isFuture,
    });
  }
  const scopeStart = points[0]?.scope ?? 0;
  const last = actual.at(-1);
  const totalDays = Math.max(1, points.length - 1);
  const compatiblePoints = points.map((point, index) => ({
    ...point,
    ideal: idealRemaining(point.scope, index, totalDays),
  }));

  return {
    cycleId,
    name: cycle.name,
    measure,
    startsAt: cycle.startsAt,
    endsAt: cycle.endsAt,
    scopeStart,
    scopeCurrent: last?.scope ?? scopeStart,
    completedCurrent: last?.completed ?? 0,
    points: compatiblePoints,
  };
}

export interface CycleChurn {
  readonly cycleId: string;
  readonly added: number;
  readonly removed: number;
  readonly source: 'snapshot' | 'activity';
}

type ChurnActivityRow = {
  readonly added: number | string;
  readonly removed: number | string;
};

export async function cycleChurn(principal: Principal, cycleId: string): Promise<CycleChurn> {
  assertCan(principal, 'project:read');
  const cycle = await loadCycle(principal, cycleId);
  const startsAt = cycle.startsAt.toISOString();

  const snapshots = await db
    .select({ total_issues: schema.cycleProgressSnapshot.totalIssues })
    .from(schema.cycleProgressSnapshot)
    .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId))
    .orderBy(asc(schema.cycleProgressSnapshot.capturedOn));

  if (snapshots.length >= 2) {
    const series = snapshots.map((row) => Number(row.total_issues));
    const churn = churnFromScopeSeries(series);
    return { cycleId, added: churn.added, removed: churn.removed, source: 'snapshot' };
  }

  const [row] = await db.execute<ChurnActivityRow>(sql`
    select
      count(*) filter (
        where field = 'cycleId'
          and coalesce(to_value ->> 'id', to_value #>> '{}') = ${cycleId}
          and created_at > ${startsAt}::timestamptz
      ) as added,
      count(*) filter (
        where field = 'cycleId'
          and coalesce(from_value ->> 'id', from_value #>> '{}') = ${cycleId}
          and created_at > ${startsAt}::timestamptz
      ) as removed
    from issue_activity
    where organization_id = ${principal.organizationId}
  `);

  return {
    cycleId,
    added: Number(row?.['added'] ?? 0),
    removed: Number(row?.['removed'] ?? 0),
    source: 'activity',
  };
}

export interface FlowMetrics {
  readonly cycleId: string;
  readonly throughput: number;
  readonly cycleTime: Distribution;
  readonly leadTime: Distribution;
  readonly cycleTimeDays: number[];
  readonly leadTimeDays: number[];
}

type DurationRow = {
  readonly cycle_days: number | string | null;
  readonly lead_days: number | string | null;
};

export async function cycleFlowMetrics(
  principal: Principal,
  cycleId: string,
): Promise<FlowMetrics> {
  assertCan(principal, 'project:read');
  await loadCycle(principal, cycleId);

  const rows = await db.execute<DurationRow>(sql`
    select
      extract(epoch from (completed_at - started_at)) / 86400 as cycle_days,
      extract(epoch from (completed_at - created_at)) / 86400 as lead_days
    from issue
    where cycle_id = ${cycleId}
      and organization_id = ${principal.organizationId}
      and archived_at is null
      and completed_at is not null
  `);

  const cycleDays = rows
    .map((row) => (row['cycle_days'] === null ? null : Number(row['cycle_days'])))
    .filter((value): value is number => value !== null && value >= 0);
  const leadDays = rows
    .map((row) => (row['lead_days'] === null ? null : Number(row['lead_days'])))
    .filter((value): value is number => value !== null && value >= 0);

  return {
    cycleId,
    throughput: rows.length,
    cycleTime: distributionOf(cycleDays),
    leadTime: distributionOf(leadDays),
    cycleTimeDays: cycleDays,
    leadTimeDays: leadDays,
  };
}

export interface VelocityPoint {
  readonly cycleId: string;
  readonly name: string;
  readonly number: number;
  readonly planned: number;
  readonly completed: number;
}

type VelocityRow = {
  readonly cycle_id: string;
  readonly name: string;
  readonly number: number | string;
  readonly planned: number | string;
  readonly completed: number | string;
};

export async function workspaceVelocity(
  principal: Principal,
  measure: Measure = 'issues',
  limit = 8,
): Promise<VelocityPoint[]> {
  assertCan(principal, 'project:read');
  const weight = weightSql(measure);

  const rows = await db.execute<VelocityRow>(sql`
    select
      c.id as cycle_id,
      c.name as name,
      c.number as number,
      coalesce(sum(${weight}), 0) as planned,
      coalesce(sum(${weight}) filter (where ws.category = 'completed'), 0) as completed
    from cycle c
    left join issue i on i.cycle_id = c.id
      and i.organization_id = c.organization_id
      and i.archived_at is null
    left join workflow_state ws on ws.id = i.state_id
      and ws.organization_id = i.organization_id
      and ws.team_id = i.team_id
    where c.organization_id = ${principal.organizationId}
    group by c.id, c.name, c.number
    order by c.number desc
    limit ${limit}
  `);

  return rows
    .map((row) => {
      const name = String(row['name'] ?? '');
      const number = Number(row['number']);
      return {
        cycleId: String(row['cycle_id']),
        name: sprintLabel({ name, number }),
        number,
        planned: Number(row['planned']),
        completed: Number(row['completed']),
      };
    })
    .reverse();
}
