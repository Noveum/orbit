import {
  type AnalyticsScope,
  type ChartResult,
  type CheckpointView,
  type CycleBurndown,
  type CycleChurn,
  cycleBurndown,
  cycleChurn,
  cycleFlowMetrics,
  type DistributionSlice,
  type FlowMetrics,
  listCheckpoints,
  listSavedAnalyticsViews,
  type Measure,
  type SavedAnalyticsViewPayload,
  type ScopePoint,
  scopeSeries,
  stateGroupBreakdown,
  teamVelocity,
  toSavedAnalyticsViewPayload,
  type VelocityPoint,
  workDistribution,
} from '@orbit/core';
import { and, db, desc, eq, isNull, schema } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';

const WORKSPACE: AnalyticsScope = { type: 'workspace' };

export interface CycleOption {
  readonly id: string;
  readonly label: string;
  readonly teamName: string;
  readonly active: boolean;
}

function estimateName(key: string): string {
  if (key === 'none' || key === '0') return 'No estimate';
  return `${key} pt${key === '1' ? '' : 's'}`;
}

async function loadCycleOptions(principal: Principal, now: Date): Promise<CycleOption[]> {
  const rows = await db
    .select({
      id: schema.cycle.id,
      number: schema.cycle.number,
      name: schema.cycle.name,
      startsAt: schema.cycle.startsAt,
      endsAt: schema.cycle.endsAt,
      completedAt: schema.cycle.completedAt,
      teamName: schema.team.name,
    })
    .from(schema.cycle)
    .innerJoin(schema.team, eq(schema.team.id, schema.cycle.teamId))
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        isNull(schema.cycle.archivedAt),
      ),
    )
    .orderBy(desc(schema.cycle.startsAt))
    .limit(40);

  return rows.map((row) => ({
    id: row.id,
    label: `${row.teamName} · ${row.name.length > 0 ? row.name : `Cycle ${row.number}`}`,
    teamName: row.teamName,
    active:
      row.completedAt === null &&
      row.startsAt.getTime() <= now.getTime() &&
      row.endsAt.getTime() > now.getTime(),
  }));
}

export interface DashboardData {
  readonly measure: Measure;
  readonly series: ScopePoint[];
  readonly byAssignee: DistributionSlice[];
  readonly byProject: DistributionSlice[];
  readonly byLabel: DistributionSlice[];
  readonly byEstimate: DistributionSlice[];
  readonly breakdown: ChartResult;
  readonly cycles: CycleOption[];
  readonly savedViews: SavedAnalyticsViewPayload[];
}

export async function loadDashboard(
  principal: Principal,
  measure: Measure,
  now: Date = new Date(),
): Promise<DashboardData> {
  assertCan(principal, 'project:read');
  const [series, byAssignee, byProject, byLabelRaw, byEstimateRaw, breakdown, cycles, savedRows] =
    await Promise.all([
      scopeSeries(principal, WORKSPACE, measure, 'week'),
      workDistribution(principal, WORKSPACE, 'assignee', measure),
      workDistribution(principal, WORKSPACE, 'project', measure),
      workDistribution(principal, WORKSPACE, 'label', measure),
      workDistribution(principal, WORKSPACE, 'estimate', measure),
      stateGroupBreakdown(principal, WORKSPACE, 'assignee', measure),
      loadCycleOptions(principal, now),
      listSavedAnalyticsViews(principal),
    ]);

  return {
    measure,
    series,
    byAssignee,
    byProject,
    byLabel: byLabelRaw,
    byEstimate: byEstimateRaw.map((slice) => ({ ...slice, name: estimateName(slice.key) })),
    breakdown,
    cycles,
    savedViews: savedRows.map(toSavedAnalyticsViewPayload),
  };
}

export interface CycleBundle {
  readonly measure: Measure;
  readonly burndown: CycleBurndown;
  readonly churn: CycleChurn;
  readonly flow: FlowMetrics;
  readonly checkpoints: CheckpointView[];
  readonly velocity: VelocityPoint[];
}

export async function loadCycleBundle(
  principal: Principal,
  cycleId: string,
  measure: Measure,
): Promise<CycleBundle> {
  assertCan(principal, 'project:read');
  const [cycle] = await db
    .select({ teamId: schema.cycle.teamId })
    .from(schema.cycle)
    .where(
      and(eq(schema.cycle.id, cycleId), eq(schema.cycle.organizationId, principal.organizationId)),
    )
    .limit(1);
  if (cycle === undefined) throw notFound('That cycle does not exist.');

  const [burndown, churn, flow, checkpoints, velocity] = await Promise.all([
    cycleBurndown(principal, cycleId, measure),
    cycleChurn(principal, cycleId),
    cycleFlowMetrics(principal, cycleId),
    listCheckpoints(principal, cycleId),
    teamVelocity(principal, cycle.teamId, measure),
  ]);

  return { measure, burndown, churn, flow, checkpoints, velocity };
}
