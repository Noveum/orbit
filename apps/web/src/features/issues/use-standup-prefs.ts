'use client';

import {
  displayOptionsSchema,
  filterGroupQuerySchema,
  GROUP_BY_FIELDS,
  ISSUE_ORDERINGS,
  VIEW_LAYOUT_MODES,
} from '@orbit/shared/filters';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import type { ViewConfig, ViewLayoutMode } from '@/features/filters/view-config.ts';
import { applyCapabilities, defaultViewConfig } from '@/features/filters/view-config.ts';

const STANDUP_PAGE = 'saved_view';

const standupPrefSchema = z.object({
  layout: z.enum(VIEW_LAYOUT_MODES),
  filter: filterGroupQuerySchema,
  groupBy: z.enum(GROUP_BY_FIELDS),
  subGroupBy: z.enum(GROUP_BY_FIELDS),
  orderBy: z.enum(ISSUE_ORDERINGS),
  display: displayOptionsSchema,
});

type StandupPref = z.infer<typeof standupPrefSchema>;

interface StandupState {
  readonly layout: ViewLayoutMode;
  readonly config: ViewConfig;
}

export interface StandupPrefsController {
  readonly ready: boolean;
  readonly layout: ViewLayoutMode;
  readonly config: ViewConfig;
  readonly dirty: boolean;
  readonly setConfig: (next: ViewConfig) => void;
  readonly setLayout: (next: ViewLayoutMode) => void;
  readonly save: () => void;
}

function storageKey(userId: string | null): string {
  return `orbit.standup.${userId ?? 'anon'}`;
}

function defaultState(): StandupState {
  return { layout: 'list', config: { ...defaultViewConfig('list'), groupBy: 'project' } };
}

function toPref(state: StandupState): StandupPref {
  return {
    layout: state.layout,
    filter: state.config.filter,
    groupBy: state.config.groupBy,
    subGroupBy: state.config.subGroupBy,
    orderBy: state.config.orderBy,
    display: state.config.display,
  };
}

function fromPref(pref: StandupPref): StandupState {
  const config = applyCapabilities(
    {
      filter: pref.filter,
      groupBy: pref.groupBy,
      subGroupBy: pref.subGroupBy,
      orderBy: pref.orderBy,
      display: pref.display,
    },
    STANDUP_PAGE,
    pref.layout,
  );
  return { layout: pref.layout, config };
}

function readState(userId: string | null): StandupState | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(storageKey(userId));
  if (raw === null) return null;
  try {
    const parsed = standupPrefSchema.safeParse(JSON.parse(raw));
    return parsed.success ? fromPref(parsed.data) : null;
  } catch {
    return null;
  }
}

function sameState(left: StandupState, right: StandupState): boolean {
  return JSON.stringify(toPref(left)) === JSON.stringify(toPref(right));
}

export function useStandupPrefs(userId: string | null): StandupPrefsController {
  const [saved, setSaved] = useState<StandupState | null>(null);
  const [working, setWorking] = useState<StandupState>(defaultState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readState(userId);
    setSaved(stored);
    setWorking(stored ?? defaultState());
    setReady(true);
  }, [userId]);

  const setConfig = useCallback((next: ViewConfig) => {
    setWorking((current) => ({
      ...current,
      config: applyCapabilities(next, STANDUP_PAGE, current.layout),
    }));
  }, []);

  const setLayout = useCallback((next: ViewLayoutMode) => {
    setWorking((current) => ({
      layout: next,
      config: applyCapabilities(current.config, STANDUP_PAGE, next),
    }));
  }, []);

  const save = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey(userId), JSON.stringify(toPref(working)));
    }
    setSaved(working);
  }, [userId, working]);

  return {
    ready,
    layout: working.layout,
    config: working.config,
    dirty: !sameState(working, saved ?? defaultState()),
    setConfig,
    setLayout,
    save,
  };
}
