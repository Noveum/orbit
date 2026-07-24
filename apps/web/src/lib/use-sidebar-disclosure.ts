'use client';

import { useCallback, useEffect, useState } from 'react';

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

export interface SidebarDisclosure {
  readonly isOpen: (id: string, fallback: boolean) => boolean;
  readonly toggle: (id: string, fallback: boolean) => void;
}

export function useSidebarDisclosure(): SidebarDisclosure {
  const [map, setMap] = useState<OpenMap>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMap(readStored());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      setReady(true);
    }
  }, [map, ready]);

  const isOpen = useCallback((id: string, fallback: boolean) => map[id] ?? fallback, [map]);

  const toggle = useCallback((id: string, fallback: boolean) => {
    setMap((prev) => ({ ...prev, [id]: !(prev[id] ?? fallback) }));
  }, []);

  return { isOpen, toggle };
}
