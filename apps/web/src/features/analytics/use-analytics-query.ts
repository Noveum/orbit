'use client';

import type { AnalyticsQuery } from '@orbit/shared/validators';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { analyticsKeys } from './analytics-keys.ts';
import {
  type AnalyticsOverviewResponse,
  type AnalyticsPeopleResponse,
  type AnalyticsProjectsResponse,
  type AnalyticsResponseByLens,
  type AnalyticsSprintsResponse,
  analyticsLensResponseSchemas,
} from './contracts.ts';
import { searchParamsForAnalytics } from './query-state.ts';

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
  }
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
  });
}
