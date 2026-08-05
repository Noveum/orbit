'use client';

import type { ViewPage } from '@orbit/shared/filters';
import { VIEW_LAYOUT_MODES } from '@orbit/shared/filters';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/query/fetcher.ts';
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

  const preferences = useQuery({
    queryKey: [VIEW_PREFERENCES_ROOT],
    queryFn: async ({ signal }): Promise<ViewPreferences> =>
      await apiFetch('/api/view-preferences', viewPreferencesSchema, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const save = useMutation({
    mutationFn: async (layout: ViewLayoutMode) =>
      await apiFetch('/api/view-preferences', viewPreferencesSchema.partial(), {
        method: 'PUT',
        body: { page, scope, layout, display: {} },
      }),
  });

  const setLayout = useCallback(
    (next: ViewLayoutMode) => {
      client.setQueryData<ViewPreferences>([VIEW_PREFERENCES_ROOT], (current) => {
        const rest = (current?.preferences ?? []).filter(
          (entry) => !(entry.page === page && entry.scope === scope),
        );
        return { preferences: [...rest, { page, scope, layout: next, display: {} }] };
      });
      save.mutate(next);
    },
    [client, page, scope, save],
  );

  return { layout: storedLayout(preferences.data, page, scope) ?? fallback, setLayout };
}
