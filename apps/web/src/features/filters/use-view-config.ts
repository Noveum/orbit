'use client';

import type { FilterGroup } from '@orbit/shared/filters';
import {
  COMPLETED_WINDOWS,
  DISPLAY_PROPERTIES,
  GROUP_BY_FIELDS,
  ISSUE_ORDERINGS,
} from '@orbit/shared/filters';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export const URL_SYNC_DELAY_MS = 300;

export function useViewConfig(
  teamId: string | null,
  layout: ViewLayoutMode,
  page: ViewPage = 'team',
): ViewConfigController {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stored, setStored] = useState<StoredDisplay | null>(null);
  const [pending, setPending] = useState<ViewConfig | null>(null);
  const syncedSearch = useRef(searchParams.toString());
  const nextWrite = useRef<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setStored(readStoredDisplay(teamId, layout));
  }, [teamId, layout]);

  const fromUrl = useMemo(() => {
    const base = withStored(defaultViewConfig(layout), stored);
    const parsed = parseViewConfig(new URLSearchParams(searchParams.toString()), layout, base);
    return applyCapabilities(parsed, page, layout);
  }, [searchParams, layout, stored, page]);

  const current = searchParams.toString();

  const write = useCallback(
    (search: string) => {
      syncTimer.current = undefined;
      nextWrite.current = null;
      if (window.location.pathname !== pathname) return;
      syncedSearch.current = search.replace(/^\?/, '');
      window.history.replaceState(null, '', `${pathname}${search}`);
    },
    [pathname],
  );

  const flush = useCallback(() => {
    const queued = nextWrite.current;
    if (queued === null) return;
    if (syncTimer.current !== undefined) clearTimeout(syncTimer.current);
    if (window.location.pathname !== pathname) return;
    write(queued);
  }, [pathname, write]);

  useEffect(() => {
    if (current === syncedSearch.current) {
      if (syncTimer.current === undefined) setPending(null);
      return;
    }
    if (syncTimer.current !== undefined) {
      clearTimeout(syncTimer.current);
      syncTimer.current = undefined;
    }
    nextWrite.current = null;
    syncedSearch.current = current;
    setPending(null);
  }, [current]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const config = pending ?? fromUrl;
  const carried = searchParams.get(VIEW_PARAM);

  const setConfig = useCallback(
    (next: ViewConfig) => {
      const sanitized = applyCapabilities(next, page, layout);
      writeStoredDisplay(teamId, layout, sanitized);
      setStored(toStored(sanitized));
      setPending(sanitized);

      const search = withViewParam(viewConfigSearch(sanitized, layout), carried);
      if (search.replace(/^\?/, '') === syncedSearch.current) {
        if (syncTimer.current !== undefined) clearTimeout(syncTimer.current);
        syncTimer.current = undefined;
        nextWrite.current = null;
        return;
      }
      nextWrite.current = search;
      if (syncTimer.current !== undefined) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => write(search), URL_SYNC_DELAY_MS);
    },
    [write, teamId, layout, page, carried],
  );

  const setFilter = useCallback(
    (filter: FilterGroup) => {
      setConfig({ ...config, filter });
    },
    [config, setConfig],
  );

  return { config, setConfig, setFilter };
}
