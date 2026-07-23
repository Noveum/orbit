import { and, asc, db, eq, schema, sql } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import type { SQL } from 'drizzle-orm';
import { requireRow, startOfUtcDay } from '../internal.ts';
import { churnFromScopeSeries, type Distribution, distributionOf, idealRemaining } from './math.ts';
import type { Measure } from './schemas.ts';

function weightSql(measure: Measure): SQL {
  return measure === 'points' ? sql`coalesce(estimate, 0)` : sql`1`;
}

function isoDay(value: Date): string {
  return startOfUtcDay(value).toISOString().slice(0, 10);
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

type SeriesRow = {
  readonly day: string;
  readonly scope: number | string;
  readonly completed: number | string;
};

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
  assertCan(principal, 'project:read');
  const cycle = await loadCycle(principal, cycleId);
  const weight = weightSql(measure);
  const today = isoDay(now);

  const rows = await db.execute<SeriesRow>(sql`
    with days as (
      select generate_series(
        date_trunc('day', ${cycle.startsAt}::timestamptz),
        date_trunc('day', ${cycle.endsAt}::timestamptz),
        interval '1 day'
      )::date as day
    ),
    scoped as (
      select
        greatest(
          (created_at at time zone 'UTC')::date,
          date_trunc('day', ${cycle.startsAt}::timestamptz)::date
        ) as created_day,
        greatest(
          (completed_at at time zone 'UTC')::date,
          date_trunc('day', ${cycle.startsAt}::timestamptz)::date
        ) as completed_day,
        completed_at,
        ${weight} as weight
      from issue
      where cycle_id = ${cycleId} and archived_at is null
    ),
    added as (
      select created_day as day, sum(weight) as amount from scoped group by created_day
    ),
    finished as (
      select completed_day as day, sum(weight) as amount
      from scoped where completed_at is not null group by completed_day
    )
    select
      to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(sum(coalesce(a.amount, 0)) over (order by d.day), 0) as scope,
      coalesce(sum(coalesce(f.amount, 0)) over (order by d.day), 0) as completed
    from days d
    left join added a on a.day = d.day
    left join finished f on f.day = d.day
    order by d.day
  `);

  const totalDays = Math.max(1, rows.length - 1);
  const points: BurndownPoint[] = rows.map((row, index) => {
    const scope = Number(row['scope']);
    const completed = Number(row['completed']);
    const day = String(row['day']);
    const isFuture = day > today;
    return {
      date: day,
      scope,
      completed: isFuture ? null : completed,
      remaining: isFuture ? null : scope - completed,
      ideal: idealRemaining(scope, index, totalDays),
      isFuture,
    };
  });

  const scopeStart = points.at(0)?.scope ?? 0;
  const present = points.filter((point) => !point.isFuture);
  const last = present.at(-1);

  return {
    cycleId,
    name: cycle.name.length > 0 ? cycle.name : `Cycle ${cycle.number}`,
    measure,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    scopeStart,
    scopeCurrent: last?.scope ?? scopeStart,
    completedCurrent: last?.completed ?? 0,
    points,
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
          and created_at > ${cycle.startsAt}::timestamptz
      ) as added,
      count(*) filter (
        where field = 'cycleId'
          and coalesce(from_value ->> 'id', from_value #>> '{}') = ${cycleId}
          and created_at > ${cycle.startsAt}::timestamptz
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

export async function teamVelocity(
  principal: Principal,
  teamId: string,
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
    left join issue i on i.cycle_id = c.id and i.archived_at is null
    left join workflow_state ws on ws.id = i.state_id
    where c.team_id = ${teamId} and c.organization_id = ${principal.organizationId}
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
        name: name.length > 0 ? name : `Cycle ${number}`,
        number,
        planned: Number(row['planned']),
        completed: Number(row['completed']),
      };
    })
    .reverse();
}
