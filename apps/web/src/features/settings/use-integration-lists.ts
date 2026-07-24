'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/query/fetcher.ts';

const repositoryPageSchema = z.object({
  repositories: z.array(
    z.object({
      repositoryId: z.string(),
      repositoryName: z.string(),
      defaultBranch: z.string(),
      installationId: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export type PickerRepository = z.infer<typeof repositoryPageSchema>['repositories'][number];

const channelPageSchema = z.object({
  channels: z.array(z.object({ channelId: z.string(), channelName: z.string() })),
  nextCursor: z.string().nullable(),
});

export type PickerChannel = z.infer<typeof channelPageSchema>['channels'][number];

function withCursor(path: string, cursor: string | null): string {
  return cursor === null ? path : `${path}?cursor=${encodeURIComponent(cursor)}`;
}

export function useRepositorySearch(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['integration', 'github', 'repositories'],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(
        withCursor('/api/integrations/github/repositories', pageParam),
        repositoryPageSchema,
        {
          signal,
        },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
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
