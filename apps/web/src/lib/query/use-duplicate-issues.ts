'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { DuplicateIssueMatch } from '@/lib/query/schemas.ts';
import { duplicateIssueListSchema } from '@/lib/query/schemas.ts';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/lib/query/search-tuning.ts';

export const DUPLICATE_SEARCH_MIN_LENGTH = 3;

export function useDuplicateIssues(
  teamId: string | null,
  title: string,
): { duplicates: readonly DuplicateIssueMatch[]; loading: boolean } {
  const typed = title.trim();
  const settled = useDebounced(typed, SEARCH_DEBOUNCE_MS);
  const enabled = settled.length >= DUPLICATE_SEARCH_MIN_LENGTH;
  const answers = enabled && settled === typed;
  const behind = typed.length >= DUPLICATE_SEARCH_MIN_LENGTH && !answers;
  const active = teamId !== null && enabled;

  const query = useQuery({
    queryKey: teamId === null ? ['disabled'] : queryKeys.issueDuplicates(teamId, settled),
    enabled: active,
    queryFn: async ({ signal }) => {
      if (teamId === null) return { duplicates: [] };
      const search = new URLSearchParams({
        teamId,
        title: settled,
      });
      return await apiFetch(
        `/api/issues/duplicates?${search.toString()}`,
        duplicateIssueListSchema,
        {
          signal,
        },
      );
    },
  });

  return {
    duplicates: active && answers ? (query.data?.duplicates ?? []) : [],
    loading: active && (behind || (answers && query.isFetching)),
  };
}
