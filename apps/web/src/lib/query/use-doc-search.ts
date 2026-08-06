'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { DocSummary } from './schemas.ts';
import { docListSchema } from './schemas.ts';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_LENGTH, useDebounced } from './search-tuning.ts';

export const DOC_SEARCH_RESULT_LIMIT = 5;

export function useDocSearch(term: string): { docs: readonly DocSummary[]; searching: boolean } {
  const settled = useDebounced(term.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = settled.length >= SEARCH_MIN_LENGTH;

  const query = useQuery({
    queryKey: queryKeys.docSearch(settled),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({
        query: settled,
        limit: String(DOC_SEARCH_RESULT_LIMIT),
      });
      return await apiFetch(`/api/docs?${search.toString()}`, docListSchema, { signal });
    },
  });

  return {
    docs: enabled ? (query.data?.docs ?? []) : [],
    searching: enabled && query.isFetching,
  };
}
