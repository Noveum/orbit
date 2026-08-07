'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { DocSummary } from './schemas.ts';
import { docListSchema } from './schemas.ts';
import { useSearchTerm } from './search-tuning.ts';

export const DOC_SEARCH_RESULT_LIMIT = 5;

export function useDocSearch(term: string): { docs: readonly DocSummary[]; searching: boolean } {
  const { settled, enabled, answers, behind } = useSearchTerm(term);

  const query = useQuery({
    queryKey: queryKeys.docSearch(settled),
    enabled,
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({
        query: settled,
        limit: String(DOC_SEARCH_RESULT_LIMIT),
      });
      return await apiFetch(`/api/docs?${search.toString()}`, docListSchema, { signal });
    },
  });

  return {
    docs: answers ? (query.data?.docs ?? []) : [],
    searching: behind || (answers && query.isFetching),
  };
}
