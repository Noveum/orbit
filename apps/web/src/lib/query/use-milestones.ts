'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { Milestone } from './schemas.ts';
import { deletedSchema, milestoneEnvelopeSchema, milestoneListSchema } from './schemas.ts';

const NO_MILESTONES: readonly Milestone[] = [];

export function useMilestones(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.milestones(projectId ?? 'none'),
    enabled: projectId !== null,
    queryFn: async ({ signal }): Promise<readonly Milestone[]> => {
      if (projectId === null) return NO_MILESTONES;
      const payload = await apiFetch(`/api/projects/${projectId}/milestones`, milestoneListSchema, {
        signal,
      });
      return payload.milestones;
    },
    staleTime: 30_000,
  });
}

export interface MilestoneDraft {
  readonly name: string;
  readonly description?: string;
  readonly targetDate?: string | null;
}

function useMilestoneRefresh(projectId: string) {
  const client = useQueryClient();
  return async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: queryKeys.milestones(projectId) });
  };
}

export function useCreateMilestone(projectId: string) {
  const refresh = useMilestoneRefresh(projectId);
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (draft: MilestoneDraft): Promise<Milestone> => {
      const payload = await apiFetch(
        `/api/projects/${projectId}/milestones`,
        milestoneEnvelopeSchema,
        { method: 'POST', body: draft },
      );
      return payload.milestone;
    },
    onError: (error) => {
      toast({
        title: 'Could not add that milestone',
        description: messageOf(error),
        tone: 'danger',
      });
    },
    onSuccess: refresh,
  });
}

export function useUpdateMilestone(projectId: string) {
  const refresh = useMilestoneRefresh(projectId);
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: { id: string; patch: MilestoneDraft }): Promise<Milestone> => {
      const payload = await apiFetch(`/api/milestones/${input.id}`, milestoneEnvelopeSchema, {
        method: 'PATCH',
        body: input.patch,
      });
      return payload.milestone;
    },
    onError: (error) => {
      toast({
        title: 'Could not save that milestone',
        description: messageOf(error),
        tone: 'danger',
      });
    },
    onSuccess: refresh,
  });
}

export function useDeleteMilestone(projectId: string) {
  const refresh = useMilestoneRefresh(projectId);
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (milestoneId: string): Promise<boolean> => {
      const payload = await apiFetch(`/api/milestones/${milestoneId}`, deletedSchema, {
        method: 'DELETE',
      });
      return payload.deleted;
    },
    onError: (error) => {
      toast({
        title: 'Could not delete that milestone',
        description: messageOf(error),
        tone: 'danger',
      });
    },
    onSuccess: refresh,
  });
}

export function useReorderMilestones(projectId: string) {
  const client = useQueryClient();
  const refresh = useMilestoneRefresh(projectId);
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (milestoneIds: readonly string[]): Promise<readonly Milestone[]> => {
      const payload = await apiFetch(
        `/api/projects/${projectId}/milestones/reorder`,
        milestoneListSchema,
        { method: 'POST', body: { milestoneIds: [...milestoneIds] } },
      );
      return payload.milestones;
    },
    onMutate: (milestoneIds) => {
      const key = queryKeys.milestones(projectId);
      const previous = client.getQueryData<readonly Milestone[]>(key);
      if (previous === undefined) return { previous };
      const byId = new Map(previous.map((entry) => [entry.id, entry]));
      const next = milestoneIds.flatMap((id) => {
        const found = byId.get(id);
        return found === undefined ? [] : [found];
      });
      if (next.length === previous.length) client.setQueryData(key, next);
      return { previous };
    },
    onError: (error, _ids, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(queryKeys.milestones(projectId), context.previous);
      }
      toast({
        title: 'Could not reorder the milestones',
        description: messageOf(error),
        tone: 'danger',
      });
    },
    onSuccess: refresh,
  });
}
