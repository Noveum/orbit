'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { StandupDetail, StandupToday } from './schemas.ts';
import { standupDetailSchema, standupListSchema, standupTodaySchema } from './schemas.ts';

export function useStandupToday(teamId: string | null) {
  return useQuery({
    queryKey: queryKeys.standupToday(teamId ?? 'none'),
    enabled: teamId !== null,
    queryFn: async ({ signal }): Promise<StandupToday> =>
      await apiFetch(
        `/api/standups?view=today&teamId=${encodeURIComponent(teamId ?? '')}`,
        standupTodaySchema,
        { signal },
      ),
  });
}

export function useStandupHistory(teamId: string | null, limit = 20) {
  return useQuery({
    queryKey: queryKeys.standupHistory(teamId ?? 'none'),
    enabled: teamId !== null,
    queryFn: async ({ signal }) =>
      await apiFetch(
        `/api/standups?teamId=${encodeURIComponent(teamId ?? '')}&limit=${limit}`,
        standupListSchema,
        { signal },
      ),
  });
}

function useStandupMutation<TInput>(
  teamId: string | null,
  request: (input: TInput) => Promise<StandupDetail>,
  failure: string,
) {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: request,
    onSuccess: (detail) => {
      client.setQueryData<StandupToday>(queryKeys.standupToday(teamId ?? 'none'), (current) =>
        current === undefined ? current : { ...current, standup: detail },
      );
    },
    onError: (error) => {
      toast({ title: failure, description: messageOf(error), tone: 'danger' });
    },
    onSettled: () => {
      client
        .invalidateQueries({ queryKey: queryKeys.standupToday(teamId ?? 'none') })
        .catch(() => undefined);
    },
  });
}

export function useOpenStandup(teamId: string | null) {
  return useStandupMutation(
    teamId,
    async () =>
      await apiFetch('/api/standups', standupDetailSchema, {
        method: 'POST',
        body: { teamId },
      }),
    'Could not open the standup',
  );
}

export function useStartStandup(teamId: string | null) {
  return useStandupMutation(
    teamId,
    async (standupId: string) =>
      await apiFetch(`/api/standups/${standupId}/start`, standupDetailSchema, { method: 'POST' }),
    'Could not start the standup',
  );
}

export interface AdvanceInput {
  readonly standupId: string;
  readonly direction: 'next' | 'previous';
}

export function useAdvanceStandup(teamId: string | null) {
  return useStandupMutation(
    teamId,
    async ({ standupId, direction }: AdvanceInput) =>
      await apiFetch(`/api/standups/${standupId}/advance`, standupDetailSchema, {
        method: 'POST',
        body: { direction, markDone: true },
      }),
    'Could not move to the next person',
  );
}

export interface FocusInput {
  readonly standupId: string;
  readonly turnId: string;
}

export function useFocusTurn(teamId: string | null) {
  return useStandupMutation(
    teamId,
    async ({ standupId, turnId }: FocusInput) =>
      await apiFetch(`/api/standups/${standupId}/focus`, standupDetailSchema, {
        method: 'POST',
        body: { turnId },
      }),
    'Could not switch to that person',
  );
}

export interface TurnPatch {
  readonly standupId: string;
  readonly turnId: string;
  readonly attendance?: 'unknown' | 'present' | 'absent';
  readonly notes?: string;
  readonly blockers?: string;
}

export function useUpdateTurn(teamId: string | null) {
  return useStandupMutation(
    teamId,
    async ({ standupId, turnId, ...patch }: TurnPatch) =>
      await apiFetch(`/api/standups/${standupId}/turns/${turnId}`, standupDetailSchema, {
        method: 'PATCH',
        body: patch,
      }),
    'Could not save that turn',
  );
}

export interface BlockerInput {
  readonly standupId: string;
  readonly turnId: string;
  readonly summary: string;
  readonly issueId?: string | null;
}

export function useAddBlocker(teamId: string | null) {
  return useStandupMutation(
    teamId,
    async ({ standupId, turnId, summary, issueId }: BlockerInput) =>
      await apiFetch(`/api/standups/${standupId}/turns/${turnId}/blockers`, standupDetailSchema, {
        method: 'POST',
        body: { summary, issueId: issueId ?? null },
      }),
    'Could not record that blocker',
  );
}

export interface ResolveBlockerInput {
  readonly standupId: string;
  readonly blockerId: string;
  readonly resolved: boolean;
}

export function useResolveBlocker(teamId: string | null) {
  return useStandupMutation(
    teamId,
    async ({ standupId, blockerId, resolved }: ResolveBlockerInput) =>
      await apiFetch(
        `/api/standups/blockers/${blockerId}?standupId=${encodeURIComponent(standupId)}`,
        standupDetailSchema,
        { method: 'PATCH', body: { resolved } },
      ),
    'Could not update that blocker',
  );
}

export function useFinishStandup(teamId: string | null) {
  return useStandupMutation(
    teamId,
    async (standupId: string) =>
      await apiFetch(`/api/standups/${standupId}`, standupDetailSchema, {
        method: 'PATCH',
        body: { status: 'finished' },
      }),
    'Could not finish the standup',
  );
}
