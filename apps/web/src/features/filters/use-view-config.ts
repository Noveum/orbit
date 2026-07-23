'use client';

import type { FilterGroup } from '@orbit/shared/filters';
import {
  COMPLETED_WINDOWS,
  DISPLAY_PROPERTIES,
  GROUP_BY_FIELDS,
  ISSUE_ORDERINGS,
} from '@orbit/shared/filters';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import type { ViewConfig, ViewLayoutMode, ViewPage } from './view-config.ts';
import {
  applyCapabilities,
  defaultViewConfig,
  parseViewConfig,
  viewConfigSearch,
} from './view-config.ts';

const storedDisplaySchema = z.object({
  groupBy: z.enum(GROUP_BY_FIELDS),
  subGroupBy: z.enum(GROUP_BY_FIELDS).default('none'),
  orderBy: z.enum(ISSUE_ORDERINGS),
  showSubIssues: z.boolean(),
  showEmptyGroups: z.boolean(),
  showCompleted: z.enum(COMPLETED_WINDOWS).default('all'),
  properties: z.array(z.enum(DISPLAY_PROPERTIES)),
});

type StoredDisplay = z.infer<typeof storedDisplaySchema>;

export function displayStorageKey(teamId: string | null, layout: ViewLayoutMode): string {
  return `orbit.display.${teamId ?? 'all'}.${layout}`;
}

export function readStoredDisplay(
  teamId: string | null,
  layout: ViewLayoutMode,
): StoredDisplay | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(displayStorageKey(teamId, layout));
  if (raw === null) return null;
  try {
    const parsed = storedDisplaySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toStored(config: ViewConfig): StoredDisplay {
  return {
    groupBy: config.groupBy,
    subGroupBy: config.subGroupBy,
    orderBy: config.orderBy,
    showSubIssues: config.display.showSubIssues,
    showEmptyGroups: config.display.showEmptyGroups,
    showCompleted: config.display.showCompleted,
    properties: [...config.display.properties],
  };
}

export function writeStoredDisplay(
  teamId: string | null,
  layout: ViewLayoutMode,
  config: ViewConfig,
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(displayStorageKey(teamId, layout), JSON.stringify(toStored(config)));
}

function withStored(base: ViewConfig, stored: StoredDisplay | null): ViewConfig {
  if (stored === null) return base;
  return {
    ...base,
    groupBy: stored.groupBy,
    subGroupBy: stored.subGroupBy,
    orderBy: stored.orderBy,
    display: {
      showSubIssues: stored.showSubIssues,
      showEmptyGroups: stored.showEmptyGroups,
      showCompleted: stored.showCompleted,
      properties: stored.properties,
    },
  };
}

export const VIEW_PARAM = 'view';

export function withViewParam(search: string, viewId: string | null): string {
  if (viewId === null || viewId.length === 0) return search;
  const separator = search.length === 0 ? '?' : '&';
  return `${search}${separator}${VIEW_PARAM}=${encodeURIComponent(viewId)}`;
}

export interface ViewConfigController {
  readonly config: ViewConfig;
  readonly setConfig: (next: ViewConfig) => void;
  readonly setFilter: (next: FilterGroup) => void;
}

export function useViewConfig(
  teamId: string | null,
  layout: ViewLayoutMode,
  page: ViewPage = 'team',
): ViewConfigController {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stored, setStored] = useState<StoredDisplay | null>(null);

  useEffect(() => {
    setStored(readStoredDisplay(teamId, layout));
  }, [teamId, layout]);

  const config = useMemo(() => {
    const base = withStored(defaultViewConfig(layout), stored);
    const parsed = parseViewConfig(new URLSearchParams(searchParams.toString()), layout, base);
    return applyCapabilities(parsed, page, layout);
  }, [searchParams, layout, stored, page]);

  const carried = searchParams.get(VIEW_PARAM);

  const setConfig = useCallback(
    (next: ViewConfig) => {
      const sanitized = applyCapabilities(next, page, layout);
      writeStoredDisplay(teamId, layout, sanitized);
      setStored(toStored(sanitized));
      const search = withViewParam(viewConfigSearch(sanitized, layout), carried);
      router.replace(`${pathname}${search}`, { scroll: false });
    },
    [router, pathname, teamId, layout, page, carried],
  );

  const setFilter = useCallback(
    (filter: FilterGroup) => {
      setConfig({ ...config, filter });
    },
    [config, setConfig],
  );

  return { config, setConfig, setFilter };
}
