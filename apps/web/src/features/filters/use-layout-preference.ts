'use client';

import type { ViewPage } from '@orbit/shared/filters';
import { VIEW_LAYOUT_MODES } from '@orbit/shared/filters';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from '@/lib/query/fetcher.ts';
import { VIEW_PREFERENCES_ROOT } from '@/lib/query/keys.ts';
import type { ViewPreferences } from '@/lib/query/schemas.ts';
import { viewPreferencesSchema } from '@/lib/query/schemas.ts';
import type { ViewLayoutMode } from './view-config.ts';

export function isLayoutMode(value: string): value is ViewLayoutMode {
  return (VIEW_LAYOUT_MODES as readonly string[]).includes(value);
}

export function storedLayout(
  preferences: ViewPreferences | undefined,
  page: ViewPage,
  scope: string,
): ViewLayoutMode | null {
  const found = preferences?.preferences.find(
    (entry) => entry.page === page && entry.scope === scope,
  );
  if (found === undefined) return null;
  return isLayoutMode(found.layout) ? found.layout : null;
}

export interface LayoutPreference {
  readonly layout: ViewLayoutMode;
  readonly setLayout: (next: ViewLayoutMode) => void;
}

export function useLayoutPreference(
  page: ViewPage,
  scope: string,
  fallback: ViewLayoutMode,
): LayoutPreference {
  const client = useQueryClient();
  const { toast } = useToast();

  const preferences = useQuery({
    queryKey: [VIEW_PREFERENCES_ROOT],
    queryFn: async ({ signal }): Promise<ViewPreferences> =>
      await apiFetch('/api/view-preferences', viewPreferencesSchema, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const save = useMutation({
    scope: { id: `view-preference:${page}:${scope}` },
    mutationFn: async (layout: ViewLayoutMode) =>
      await apiFetch('/api/view-preferences', viewPreferencesSchema.partial(), {
        method: 'PUT',
        body: { page, scope, layout, display: {} },
      }),
    onMutate: (layout: ViewLayoutMode) => {
      const previous = client.getQueryData<ViewPreferences>([VIEW_PREFERENCES_ROOT]);
      client.setQueryData<ViewPreferences>([VIEW_PREFERENCES_ROOT], (current) => {
        const rest = (current?.preferences ?? []).filter(
          (entry) => !(entry.page === page && entry.scope === scope),
        );
        return { preferences: [...rest, { page, scope, layout, display: {} }] };
      });
      return { previous };
    },
    onError: (error, _layout, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData<ViewPreferences>([VIEW_PREFERENCES_ROOT], context.previous);
      }
      toast({
        title: 'Could not remember that layout',
        description: messageOf(error),
        tone: 'danger',
      });
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: [VIEW_PREFERENCES_ROOT] }).catch(() => undefined);
    },
  });

  const mutate = save.mutate;
  const setLayout = useCallback((next: ViewLayoutMode) => mutate(next), [mutate]);

  return { layout: storedLayout(preferences.data, page, scope) ?? fallback, setLayout };
}
