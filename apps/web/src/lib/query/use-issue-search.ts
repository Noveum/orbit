'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiFetch } from './fetcher.ts';
import { SEARCH_ROOT } from './keys.ts';
import type { Issue } from './schemas.ts';
import { issueListSchema } from './schemas.ts';

export const SEARCH_DEBOUNCE_MS = 140;
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_RESULT_LIMIT = 8;

export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

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
