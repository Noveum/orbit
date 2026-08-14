'use client';

import { sprintLabel } from '@orbit/shared/utils';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { z } from 'zod';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';

const sprintSchema = z.object({
  id: z.string(),
  teamId: z.string().nullable(),
  number: z.number(),
  name: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  completedAt: z.string().nullable(),
});

export type Sprint = z.infer<typeof sprintSchema>;

const sprintEnvelope = z.object({ cycle: sprintSchema });
const closedEnvelope = z.object({
  cycle: sprintSchema,
  nextCycle: sprintSchema,
  rolledOverIssueIds: z.array(z.string()),
});
const deletedEnvelope = z.object({ deleted: z.boolean() });

export interface SprintDraft {
  readonly name?: string | undefined;
  readonly startsAt?: string | undefined;
  readonly endsAt?: string | undefined;
}

export interface SprintEdit {
  readonly id: string;
  readonly name?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly shiftFollowing?: boolean;
}

function useRefreshSprints(): () => void {
  const router = useRouter();
  return useCallback(() => {
    router.refresh();
  }, [router]);
}

function useFailureToast(title: string): (error: unknown) => void {
  const { toast } = useToast();
  return useCallback(
    (error: unknown) => {
      toast({ title, description: messageOf(error), tone: 'danger' });
    },
    [toast, title],
  );
}

export function useCreateSprint() {
  const refresh = useRefreshSprints();
  const { toast } = useToast();
  const onError = useFailureToast('Could not create that sprint');

  return useMutation({
    mutationFn: async (draft: SprintDraft): Promise<Sprint> => {
      const payload = await apiFetch('/api/cycles', sprintEnvelope, {
        method: 'POST',
        body: draft,
      });
      return payload.cycle;
    },
    onSuccess: (cycle) => {
      toast({ title: `Created ${cycle.name}` });
      refresh();
    },
    onError,
  });
}

export function useUpdateSprint() {
  const refresh = useRefreshSprints();
  const onError = useFailureToast('Could not save that sprint');

  return useMutation({
    mutationFn: async ({ id, ...patch }: SprintEdit): Promise<Sprint> => {
      const payload = await apiFetch(`/api/cycles/${id}`, sprintEnvelope, {
        method: 'PATCH',
        body: patch,
      });
      return payload.cycle;
    },
    onSuccess: refresh,
    onError,
  });
}

export function useStartSprint() {
  const refresh = useRefreshSprints();
  const { toast } = useToast();
  const onError = useFailureToast('Could not start that sprint');

  return useMutation({
    mutationFn: async (id: string): Promise<Sprint> => {
      const payload = await apiFetch(`/api/cycles/${id}/start`, sprintEnvelope, {
        method: 'POST',
      });
      return payload.cycle;
    },
    onSuccess: (cycle) => {
      toast({ title: `${cycle.name} is running` });
      refresh();
    },
    onError,
  });
}

export function useCompleteSprint() {
  const refresh = useRefreshSprints();
  const { toast } = useToast();
  const onError = useFailureToast('Could not complete that sprint');

  return useMutation({
    mutationFn: async (id: string) =>
      await apiFetch(`/api/cycles/${id}/complete`, closedEnvelope, { method: 'POST' }),
    onSuccess: (result) => {
      const rolled = result.rolledOverIssueIds.length;
      toast({
        title: `Closed ${result.cycle.name}`,
        description:
          rolled === 0
            ? 'Nothing was left unfinished.'
            : `${rolled} ${rolled === 1 ? 'issue' : 'issues'} rolled into ${sprintLabel(result.nextCycle)}.`,
      });
      refresh();
    },
    onError,
  });
}

export function useDeleteSprint() {
  const refresh = useRefreshSprints();
  const { toast } = useToast();
  const onError = useFailureToast('Could not delete that sprint');

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiFetch(`/api/cycles/${id}`, deletedEnvelope, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast({ title: 'Sprint deleted' });
      refresh();
    },
    onError,
  });
}
