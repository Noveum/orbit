'use client';

import type { GroupByField, ViewLayout } from '@orbit/shared/filters';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { View } from './schemas.ts';
import { deletedSchema, viewEnvelopeSchema, viewListSchema } from './schemas.ts';

export interface ViewInput {
  readonly name: string;
  readonly filter: Record<string, unknown>;
  readonly layout: ViewLayout;
  readonly groupBy: GroupByField;
  readonly shared: boolean;
}

export function useViews() {
  return useQuery({
    queryKey: queryKeys.views(),
    queryFn: async ({ signal }): Promise<readonly View[]> => {
      const payload = await apiFetch('/api/views', viewListSchema, { signal });
      return payload.views;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

function sortViews(views: readonly View[]): View[] {
  return [...views].sort((left, right) => left.name.localeCompare(right.name));
}

export function useCreateView() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: ViewInput): Promise<View> => {
      const result = await apiFetch('/api/views', viewEnvelopeSchema, {
        method: 'POST',
        body: input,
      });
      return result.view;
    },
    onError: (error) => {
      toast({ title: 'Could not save that view', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (view) => {
      client.setQueryData<readonly View[]>(queryKeys.views(), (current) =>
        sortViews([...(current ?? []).filter((entry) => entry.id !== view.id), view]),
      );
      toast({ title: `Saved "${view.name}"` });
    },
  });
}

export function useUpdateView() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<ViewInput> }): Promise<View> => {
      const result = await apiFetch(`/api/views/${input.id}`, viewEnvelopeSchema, {
        method: 'PATCH',
        body: input.patch,
      });
      return result.view;
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: queryKeys.views() });
      const previous = client.getQueryData<readonly View[]>(queryKeys.views());
      client.setQueryData<readonly View[]>(queryKeys.views(), (current) =>
        sortViews(
          (current ?? []).map((entry) =>
            entry.id === input.id ? { ...entry, ...input.patch } : entry,
          ),
        ),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(queryKeys.views(), context.previous);
      }
      toast({ title: 'Could not update that view', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (view) => {
      client.setQueryData<readonly View[]>(queryKeys.views(), (current) =>
        sortViews((current ?? []).map((entry) => (entry.id === view.id ? view : entry))),
      );
    },
  });
}

export function useDeleteView() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiFetch(`/api/views/${id}`, deletedSchema, { method: 'DELETE' });
    },
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: queryKeys.views() });
      const previous = client.getQueryData<readonly View[]>(queryKeys.views());
      client.setQueryData<readonly View[]>(queryKeys.views(), (current) =>
        (current ?? []).filter((entry) => entry.id !== id),
      );
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(queryKeys.views(), context.previous);
      }
      toast({ title: 'Could not delete that view', description: messageOf(error), tone: 'danger' });
    },
  });
}
