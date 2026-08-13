'use client';

import type { AnalyticsQuery } from '@orbit/shared/validators';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { analyticsKeys } from '@/lib/query/keys.ts';
import { analyticsLensResponseSchema } from './contracts.ts';
import { searchParamsForAnalytics } from './query-state.ts';

export function useAnalyticsQuery(query: AnalyticsQuery) {
  return useQuery({
    queryKey: analyticsKeys.lens(query.lens, query),
    queryFn: async ({ signal }) => {
      const search = searchParamsForAnalytics(query).toString();
      const suffix = search.length === 0 ? '' : `?${search}`;
      return await apiFetch(`/api/analytics/${query.lens}${suffix}`, analyticsLensResponseSchema, {
        signal,
      });
    },
  });
}
