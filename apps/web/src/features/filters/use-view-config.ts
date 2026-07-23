'use client';

import type { FilterPredicate } from '@orbit/shared/filters';
import { GROUP_BY_FIELDS } from '@orbit/shared/filters';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import type { ViewConfig, ViewLayoutMode } from './view-config.ts';
import {
  defaultViewConfig,
  ISSUE_ORDERINGS,
  ISSUE_PROPERTIES,
  parseViewConfig,
  viewConfigSearch,
} from './view-config.ts';

const storedDisplaySchema = z.object({
  groupBy: z.enum(GROUP_BY_FIELDS),
  orderBy: z.enum(ISSUE_ORDERINGS),
  showSubIssues: z.boolean(),
  showEmptyGroups: z.boolean(),
  properties: z.array(z.enum(ISSUE_PROPERTIES)),
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

export function writeStoredDisplay(
  teamId: string | null,
  layout: ViewLayoutMode,
  config: ViewConfig,
): void {
  if (typeof window === 'undefined') return;
  const display: StoredDisplay = {
    groupBy: config.groupBy,
    orderBy: config.orderBy,
    showSubIssues: config.showSubIssues,
    showEmptyGroups: config.showEmptyGroups,
    properties: [...config.properties],
  };
  window.localStorage.setItem(displayStorageKey(teamId, layout), JSON.stringify(display));
}

export interface ViewConfigController {
  readonly config: ViewConfig;
  readonly setConfig: (next: ViewConfig) => void;
  readonly setPredicates: (next: readonly FilterPredicate[]) => void;
}

export function useViewConfig(teamId: string | null, layout: ViewLayoutMode): ViewConfigController {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stored, setStored] = useState<StoredDisplay | null>(() =>
    readStoredDisplay(teamId, layout),
  );

  const config = useMemo(() => {
    const base = defaultViewConfig(layout);
    return parseViewConfig(
      new URLSearchParams(searchParams.toString()),
      layout,
      stored === null ? base : { ...base, ...stored },
    );
  }, [searchParams, layout, stored]);

  const setConfig = useCallback(
    (next: ViewConfig) => {
      writeStoredDisplay(teamId, layout, next);
      setStored({
        groupBy: next.groupBy,
        orderBy: next.orderBy,
        showSubIssues: next.showSubIssues,
        showEmptyGroups: next.showEmptyGroups,
        properties: [...next.properties],
      });
      router.replace(`${pathname}${viewConfigSearch(next, layout)}`, { scroll: false });
    },
    [router, pathname, teamId, layout],
  );

  const setPredicates = useCallback(
    (predicates: readonly FilterPredicate[]) => {
      setConfig({ ...config, predicates });
    },
    [config, setConfig],
  );

  return { config, setConfig, setPredicates };
}
