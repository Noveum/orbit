'use client';

import type { AnalyticsInsightsQuery, AnalyticsQuery } from '@orbit/shared/validators';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@/lib/query/fetcher.ts';
import { analyticsKeys } from './analytics-keys.ts';
import {
  type AnalyticsInsightsResponse,
  type AnalyticsOverviewResponse,
  type AnalyticsPeopleResponse,
  type AnalyticsProjectsResponse,
  type AnalyticsResponseByLens,
  type AnalyticsSprintsResponse,
  analyticsInsightsWireResponse,
  analyticsLensResponseSchemas,
} from './contracts.ts';
import { searchParamsForAnalytics, searchParamsForInsights } from './query-state.ts';

async function fetchAnalyticsLens(
  query: AnalyticsQuery,
  signal: AbortSignal,
): Promise<AnalyticsResponseByLens[keyof AnalyticsResponseByLens]> {
  const search = searchParamsForAnalytics(query).toString();
  const suffix = search.length === 0 ? '' : `?${search}`;
  const path = `/api/analytics/${query.lens}${suffix}`;
  switch (query.lens) {
    case 'overview':
      return await apiFetch(path, analyticsLensResponseSchemas.overview, { signal });
    case 'sprints':
      return await apiFetch(path, analyticsLensResponseSchemas.sprints, { signal });
    case 'projects':
      return await apiFetch(path, analyticsLensResponseSchemas.projects, { signal });
    case 'people':
      return await apiFetch(path, analyticsLensResponseSchemas.people, { signal });
    case 'insights':
      throw new ApiError(404, 'not_found', 'Insights analytics is not available yet.');
  }
}

export async function fetchInsights(
  query: AnalyticsInsightsQuery,
  signal: AbortSignal,
): Promise<AnalyticsInsightsResponse> {
  const search = searchParamsForInsights(query).toString();
  return await apiFetch(`/api/analytics/insights?${search}`, analyticsInsightsWireResponse, {
    signal,
  });
}

export function useInsightsQuery(
  query: AnalyticsInsightsQuery,
  options?: { readonly enabled?: boolean },
): UseQueryResult<AnalyticsInsightsResponse> {
  return useQuery<AnalyticsInsightsResponse>({
    queryKey: analyticsKeys.insights(query),
    queryFn: async ({ signal }) => await fetchInsights(query, signal),
    ...(options?.enabled === false ? { enabled: false } : {}),
  });
}

export function useAnalyticsQuery(
  query: AnalyticsQuery & { readonly lens: 'overview' },
): UseQueryResult<AnalyticsOverviewResponse>;
export function useAnalyticsQuery(
  query: AnalyticsQuery & { readonly lens: 'sprints' },
): UseQueryResult<AnalyticsSprintsResponse>;
export function useAnalyticsQuery(
  query: AnalyticsQuery & { readonly lens: 'projects' },
): UseQueryResult<AnalyticsProjectsResponse>;
export function useAnalyticsQuery(
  query: AnalyticsQuery & { readonly lens: 'people' },
): UseQueryResult<AnalyticsPeopleResponse>;
export function useAnalyticsQuery(
  query: AnalyticsQuery,
): UseQueryResult<AnalyticsResponseByLens[keyof AnalyticsResponseByLens]>;
export function useAnalyticsQuery(
  query: AnalyticsQuery,
): UseQueryResult<AnalyticsResponseByLens[keyof AnalyticsResponseByLens]> {
  return useQuery<AnalyticsResponseByLens[keyof AnalyticsResponseByLens]>({
    queryKey: analyticsKeys.lens(query.lens, query),
    queryFn: async ({ signal }) => await fetchAnalyticsLens(query, signal),
    ...(query.lens === 'insights' ? { enabled: false } : {}),
  });
}
