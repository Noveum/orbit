import {
  type AnalyticsDrilldownInput,
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
  listAnalyticsDrilldown,
  listCheckpoints,
  listSavedAnalyticsViews,
  loadAnalyticsOverview,
  loadPeopleAnalytics,
  loadProjectAnalytics,
  loadSprintAnalytics,
  type Measure,
  type SavedAnalyticsViewPayload,
  type ScopePoint,
  scopeSeries,
  stateGroupBreakdown,
  toSavedAnalyticsViewPayload,
  type VelocityPoint,
  workDistribution,
  workspaceVelocity,
} from '@orbit/core';
import { and, db, desc, eq, isNull, schema } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { sprintLabel } from '@orbit/shared/utils';
import type { AnalyticsLens, AnalyticsQuery } from '@orbit/shared/validators';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { analyticsKeys } from './analytics-keys.ts';
import {
  type AnalyticsDrilldownResponse,
  type AnalyticsPeopleResponse,
  type AnalyticsProjectsResponse,
  type AnalyticsResponseByLens,
  type AnalyticsSprintsResponse,
  analyticsDrilldownWireResponse,
  analyticsWireResponse,
} from './contracts.ts';
import { selectedAssigneeIds } from './person-focus.ts';

const WORKSPACE: AnalyticsScope = { type: 'workspace' };

export interface CycleOption {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
}

function estimateName(key: string): string {
  if (key === 'none' || key === '0') return 'No estimate';
  return `${key} pt${key === '1' ? '' : 's'}`;
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
    })
    .from(schema.cycle)
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
    label: sprintLabel(row),
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
    .select({ id: schema.cycle.id })
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
    workspaceVelocity(principal, measure),
  ]);

  return { measure, burndown, churn, flow, checkpoints, velocity };
}

export async function loadSprintsAnalyticsData(
  principal: Principal,
  query: AnalyticsQuery,
): Promise<AnalyticsSprintsResponse> {
  const focusedQuery = sprintQueryForPrincipal(principal, query);
  return analyticsWireResponse('sprints', {
    lens: 'sprints',
    ...(await loadSprintAnalytics(principal, { ...focusedQuery, lens: 'sprints' })),
  });
}

function sprintQueryForPrincipal(principal: Principal, query: AnalyticsQuery): AnalyticsQuery {
  if (query.focus.personId !== undefined) return query;
  return selectedAssigneeIds(query).length > 0
    ? query
    : { ...query, focus: { ...query.focus, personId: principal.userId } };
}

export async function loadSelectedSprintAnalyticsData(
  principal: Principal,
  query: AnalyticsQuery,
  selectedSprintId: string,
): Promise<AnalyticsSprintsResponse> {
  const focusedQuery = sprintQueryForPrincipal(principal, query);
  return analyticsWireResponse('sprints', {
    lens: 'sprints',
    ...(await loadSprintAnalytics(
      principal,
      { ...focusedQuery, lens: 'sprints' },
      { selectedSprintId },
    )),
  });
}

export async function loadAnalyticsLensData(
  principal: Principal,
  lens: 'overview',
  query: AnalyticsQuery,
): Promise<AnalyticsResponseByLens['overview']>;
export async function loadAnalyticsLensData(
  principal: Principal,
  lens: 'sprints',
  query: AnalyticsQuery,
): Promise<AnalyticsSprintsResponse>;
export async function loadAnalyticsLensData(
  principal: Principal,
  lens: 'projects',
  query: AnalyticsQuery,
): Promise<AnalyticsProjectsResponse>;
export async function loadAnalyticsLensData(
  principal: Principal,
  lens: 'people',
  query: AnalyticsQuery,
): Promise<AnalyticsPeopleResponse>;
export async function loadAnalyticsLensData(
  principal: Principal,
  lens: AnalyticsLens,
  query: AnalyticsQuery,
): Promise<AnalyticsResponseByLens[AnalyticsLens]>;
export async function loadAnalyticsLensData(
  principal: Principal,
  lens: AnalyticsLens,
  query: AnalyticsQuery,
): Promise<AnalyticsResponseByLens[AnalyticsLens]> {
  const normalized = { ...query, lens };
  switch (lens) {
    case 'overview':
      return analyticsWireResponse('overview', await loadAnalyticsOverview(principal, normalized));
    case 'sprints':
      return await loadSprintsAnalyticsData(principal, normalized);
    case 'projects':
      return analyticsWireResponse('projects', await loadProjectAnalytics(principal, normalized));
    case 'people':
      return analyticsWireResponse('people', await loadPeopleAnalytics(principal, normalized));
  }
}

export async function loadAnalyticsDrilldownData(
  principal: Principal,
  input: AnalyticsDrilldownInput,
): Promise<AnalyticsDrilldownResponse> {
  return analyticsDrilldownWireResponse(await listAnalyticsDrilldown(principal, input));
}

export async function dehydratedAnalyticsLens(principal: Principal, query: AnalyticsQuery) {
  const client = new QueryClient();
  const payload = await loadAnalyticsLensData(principal, query.lens, query);
  client.setQueryData(analyticsKeys.lens(query.lens, query), payload);
  return dehydrate(client);
}
