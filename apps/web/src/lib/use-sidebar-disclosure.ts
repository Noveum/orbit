'use client';

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'orbit:sidebar:disclosure';

type OpenMap = Record<string, boolean>;

function readStored(): OpenMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: OpenMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

const EMPTY: OpenMap = {};

let snapshot: OpenMap | null = null;
const listeners = new Set<() => void>();

function current(): OpenMap {
  if (typeof window === 'undefined') return EMPTY;
  snapshot ??= readStored();
  return snapshot;
}

function publish(next: OpenMap): void {
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

export function resetSidebarDisclosure(): void {
  snapshot = null;
  for (const listener of listeners) listener();
}

export interface SidebarDisclosure {
  readonly isOpen: (id: string, fallback: boolean) => boolean;
  readonly toggle: (id: string, fallback: boolean) => void;
  readonly openAll: (ids: readonly string[]) => void;
  readonly setAll: (ids: readonly string[], open: boolean) => void;
}

export function useSidebarDisclosure(): SidebarDisclosure {
  const map = useSyncExternalStore(subscribe, current, () => EMPTY);

  const isOpen = useCallback((id: string, fallback: boolean) => map[id] ?? fallback, [map]);

  const toggle = useCallback((id: string, fallback: boolean) => {
    const now = current();
    publish({ ...now, [id]: !(now[id] ?? fallback) });
  }, []);

  const openAll = useCallback((ids: readonly string[]) => {
    const now = current();
    if (ids.every((id) => now[id] === true)) return;
    const next: OpenMap = { ...now };
    for (const id of ids) next[id] = true;
    publish(next);
  }, []);

  const setAll = useCallback((ids: readonly string[], open: boolean) => {
    const now = current();
    if (ids.every((id) => (now[id] ?? true) === open)) return;
    const next: OpenMap = { ...now };
    for (const id of ids) next[id] = open;
    publish(next);
  }, []);

  return { isOpen, toggle, openAll, setAll };
}
