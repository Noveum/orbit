'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { DuplicateIssueMatch } from './schemas.ts';
import { duplicateIssueListSchema } from './schemas.ts';
import { useSearchTerm } from './search-tuning.ts';

export function useDuplicateIssues(
  teamId: string | null,
  title: string,
): { duplicates: readonly DuplicateIssueMatch[]; loading: boolean } {
  const { settled, enabled, answers, behind } = useSearchTerm(title);
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
