'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/query/fetcher.ts';

const channelPageSchema = z.object({
  channels: z.array(z.object({ channelId: z.string(), channelName: z.string() })),
  nextCursor: z.string().nullable(),
});

export type PickerChannel = z.infer<typeof channelPageSchema>['channels'][number];

function withCursor(path: string, cursor: string | null): string {
  return cursor === null ? path : `${path}?cursor=${encodeURIComponent(cursor)}`;
}

export function useChannelSearch(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['integration', 'slack', 'channels'],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(withCursor('/api/integrations/slack/channels', pageParam), channelPageSchema, {
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
}
