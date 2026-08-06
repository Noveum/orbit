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
import { and, db, desc, eq, inArray, isNull, type SQL, schema, sql } from '@orbit/db';
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

function visibleCycleTeams(principal: Principal): SQL | undefined {
  if (principal.role === 'admin') return undefined;
  if (principal.teamIds.length === 0) return sql`false`;
  return inArray(schema.cycle.teamId, [...principal.teamIds]);
}

export async function loadCycleOptions(
  principal: Principal,
  now: Date = new Date(),
): Promise<CycleOption[]> {
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
        visibleCycleTeams(principal),
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

export function loadScopeSeries(principal: Principal, measure: Measure): Promise<ScopePoint[]> {
  return scopeSeries(principal, WORKSPACE, measure, 'week');
}

export interface Distributions {
  readonly byAssignee: DistributionSlice[];
  readonly byProject: DistributionSlice[];
  readonly byLabel: DistributionSlice[];
  readonly byEstimate: DistributionSlice[];
}

export async function loadDistributions(
  principal: Principal,
  measure: Measure,
): Promise<Distributions> {
  const [byAssignee, byProject, byLabel, byEstimateRaw] = await Promise.all([
    workDistribution(principal, WORKSPACE, 'assignee', measure),
    workDistribution(principal, WORKSPACE, 'project', measure),
    workDistribution(principal, WORKSPACE, 'label', measure),
    workDistribution(principal, WORKSPACE, 'estimate', measure),
  ]);
  return {
    byAssignee,
    byProject,
    byLabel,
    byEstimate: byEstimateRaw.map((slice) => ({ ...slice, name: estimateName(slice.key) })),
  };
}

export function loadBreakdown(principal: Principal, measure: Measure): Promise<ChartResult> {
  return stateGroupBreakdown(principal, WORKSPACE, 'assignee', measure);
}

export async function loadSavedViews(principal: Principal): Promise<SavedAnalyticsViewPayload[]> {
  const rows = await listSavedAnalyticsViews(principal);
  return rows.map(toSavedAnalyticsViewPayload);
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
