'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetcher.ts';
import { SEARCH_ROOT } from './keys.ts';
import type { Issue } from './schemas.ts';
import { issueListSchema } from './schemas.ts';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_LENGTH, useDebounced } from './search-tuning.ts';

export { SEARCH_DEBOUNCE_MS, SEARCH_MIN_LENGTH, useDebounced } from './search-tuning.ts';

export const SEARCH_RESULT_LIMIT = 8;

export function useIssueSearch(term: string): { issues: readonly Issue[]; searching: boolean } {
  const settled = useDebounced(term.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = settled.length >= SEARCH_MIN_LENGTH;

  const query = useQuery({
    queryKey: [SEARCH_ROOT, settled],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({
        query: settled,
        limit: String(SEARCH_RESULT_LIMIT),
        orderBy: 'updated',
      });
      return await apiFetch(`/api/issues?${search.toString()}`, issueListSchema, { signal });
    },
  });

  return {
    issues: enabled ? (query.data?.issues ?? []) : [],
    searching: enabled && query.isFetching,
  };
}
