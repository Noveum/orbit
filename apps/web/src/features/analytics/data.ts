import {
  type AnalyticsDrilldownInput,
  type CheckpointView,
  type CycleBurndown,
  type CycleChurn,
  cycleBurndown,
  cycleChurn,
  cycleFlowMetrics,
  type FlowMetrics,
  listAnalyticsDrilldown,
  listCheckpoints,
  listSavedAnalyticsViews,
  loadAnalyticsInsights,
  loadAnalyticsOverview,
  loadPeopleAnalytics,
  loadProjectAnalytics,
  loadSprintAnalytics,
  type Measure,
  type SavedAnalyticsViewPayload,
  toSavedAnalyticsViewPayload,
  type VelocityPoint,
  workspaceVelocity,
} from '@orbit/core';
import { and, db, eq, schema } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import type {
  AnalyticsInsightsQuery,
  AnalyticsLens,
  AnalyticsQuery,
  InsightConfig,
} from '@orbit/shared/validators';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { analyticsKeys } from './analytics-keys.ts';
import {
  type AnalyticsDrilldownResponse,
  type AnalyticsInsightsResponse,
  type AnalyticsPeopleResponse,
  type AnalyticsProjectsResponse,
  type AnalyticsResponseByLens,
  type AnalyticsSprintsResponse,
  analyticsDrilldownWireResponse,
  analyticsInsightsWireResponse,
  analyticsWireResponse,
} from './contracts.ts';
import { selectedAssigneeIds } from './person-focus.ts';

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
): Promise<AnalyticsResponseByLens[keyof AnalyticsResponseByLens]>;
export async function loadAnalyticsLensData(
  principal: Principal,
  lens: AnalyticsLens,
  query: AnalyticsQuery,
): Promise<AnalyticsResponseByLens[keyof AnalyticsResponseByLens]> {
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
    case 'insights':
      throw notFound('Insights analytics is not available yet.');
  }
}

export async function loadAnalyticsDrilldownData(
  principal: Principal,
  input: AnalyticsDrilldownInput,
): Promise<AnalyticsDrilldownResponse> {
  return analyticsDrilldownWireResponse(await listAnalyticsDrilldown(principal, input));
}

export async function loadAnalyticsInsightsData(
  principal: Principal,
  query: AnalyticsQuery,
  insight: InsightConfig,
  now: Date = new Date(),
): Promise<AnalyticsInsightsResponse> {
  return analyticsInsightsWireResponse.parse(
    await loadAnalyticsInsights(principal, query, insight, { now }),
  );
}

export async function dehydratedAnalyticsInsights(
  principal: Principal,
  query: AnalyticsInsightsQuery,
) {
  const client = new QueryClient();
  const payload = await loadAnalyticsInsightsData(principal, query, query.insight);
  client.setQueryData(analyticsKeys.insights(query), payload);
  return dehydrate(client);
}

export async function dehydratedAnalyticsLens(principal: Principal, query: AnalyticsQuery) {
  const client = new QueryClient();
  const payload = await loadAnalyticsLensData(principal, query.lens, query);
  client.setQueryData(analyticsKeys.lens(query.lens, query), payload);
  return dehydrate(client);
}
