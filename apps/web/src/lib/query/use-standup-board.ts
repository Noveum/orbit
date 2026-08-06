'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { StandupBoardPayload } from './schemas.ts';
import { standupBoardPayloadSchema } from './schemas.ts';

export function useStandupBoard(since: Date) {
  const at = since.toISOString();
  return useQuery({
    queryKey: queryKeys.standupBoard(at),
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<StandupBoardPayload> =>
      await apiFetch(
        `/api/standup/board?since=${encodeURIComponent(at)}`,
        standupBoardPayloadSchema,
        { signal },
      ),
  });
}
