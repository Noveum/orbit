'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import {
  activatesFocusedControl,
  type BufferedStep,
  eventToStep,
  isEditableTarget,
  isModifierKey,
  pruneBuffer,
  SEQUENCE_TIMEOUT_MS,
} from './binding.ts';
import { type HotkeyEntry, HotkeyRegistry, selectMatch } from './registry.ts';

const HotkeyContext = createContext<HotkeyRegistry | null>(null);

export function useHotkeyRegistry(): HotkeyRegistry {
  const registry = useContext(HotkeyContext);
  if (registry === null) throw new Error('useHotkeyRegistry must be used inside HotkeyProvider');
  return registry;
}

export function useHotkeyList(): readonly HotkeyEntry[] {
  const registry = useHotkeyRegistry();
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}

export function HotkeyProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new HotkeyRegistry());

  useEffect(() => {
    let buffer: BufferedStep[] = [];

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isModifierKey(event.key)) return;
      if (activatesFocusedControl(event, event.target)) return;
      const editable = isEditableTarget(event.target);
      const now = Date.now();
      buffer = editable ? [] : pruneBuffer(buffer, now, SEQUENCE_TIMEOUT_MS);
      buffer.push({ ...eventToStep(event), at: now });
      const match = selectMatch(registry.getSnapshot(), buffer, editable);
      if (match === null) return;
      buffer = [];
      if (match.preventDefault) event.preventDefault();
      match.run(event);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registry]);

  return <HotkeyContext.Provider value={registry}>{children}</HotkeyContext.Provider>;
}
