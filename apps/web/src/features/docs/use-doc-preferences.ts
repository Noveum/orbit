'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const DOC_PREFERENCES_STORAGE_KEY = 'orbit:docs:preferences';

const STORAGE_KEY = DOC_PREFERENCES_STORAGE_KEY;

export type EditorMode = 'rich' | 'markdown';
export type ReadingWidth = 'comfortable' | 'wide' | 'full';

export interface DocPreferences {
  readonly mode: EditorMode;
  readonly toolbar: boolean;
  readonly width: ReadingWidth;
}

export const DEFAULT_DOC_PREFERENCES: DocPreferences = {
  mode: 'markdown',
  toolbar: false,
  width: 'wide',
};

const MODES: readonly EditorMode[] = ['rich', 'markdown'];
const WIDTHS: readonly ReadingWidth[] = ['comfortable', 'wide', 'full'];

export function parsePreferences(raw: unknown): DocPreferences {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_DOC_PREFERENCES;
  }
  const stored = raw as Partial<Record<keyof DocPreferences, unknown>>;
  return {
    mode: MODES.includes(stored.mode as EditorMode)
      ? (stored.mode as EditorMode)
      : DEFAULT_DOC_PREFERENCES.mode,
    toolbar: typeof stored.toolbar === 'boolean' ? stored.toolbar : DEFAULT_DOC_PREFERENCES.toolbar,
    width: WIDTHS.includes(stored.width as ReadingWidth)
      ? (stored.width as ReadingWidth)
      : DEFAULT_DOC_PREFERENCES.width,
  };
}

export const READING_WIDTH_CLASS: Record<ReadingWidth, string> = {
  comfortable: 'max-w-[45rem]',
  wide: 'max-w-[68rem]',
  full: 'max-w-none',
};

function readStored(): DocPreferences {
  if (typeof window === 'undefined') return DEFAULT_DOC_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_DOC_PREFERENCES;
    return parsePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_DOC_PREFERENCES;
  }
}

let snapshot: DocPreferences | null = null;
const listeners = new Set<() => void>();

function current(): DocPreferences {
  if (typeof window === 'undefined') return DEFAULT_DOC_PREFERENCES;
  snapshot ??= readStored();
  return snapshot;
}

function publish(next: DocPreferences): void {
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    snapshot = next;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    snapshot = readStored();
    for (const entry of listeners) entry();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function resetDocPreferences(): void {
  snapshot = null;
  for (const listener of listeners) listener();
}

export interface DocPreferenceControl extends DocPreferences {
  readonly setMode: (mode: EditorMode) => void;
  readonly toggleToolbar: () => void;
  readonly setWidth: (width: ReadingWidth) => void;
}

export function useDocPreferences(): DocPreferenceControl {
  const preferences = useSyncExternalStore(subscribe, current, () => DEFAULT_DOC_PREFERENCES);

  const setMode = useCallback((mode: EditorMode) => publish({ ...current(), mode }), []);
  const toggleToolbar = useCallback(
    () => publish({ ...current(), toolbar: !current().toolbar }),
    [],
  );
  const setWidth = useCallback((width: ReadingWidth) => publish({ ...current(), width }), []);

  return { ...preferences, setMode, toggleToolbar, setWidth };
}
