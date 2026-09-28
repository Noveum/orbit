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

function shouldIgnoreKeyDown(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    typeof event.key !== 'string' ||
    event.key.length === 0 ||
    isModifierKey(event.key) ||
    activatesFocusedControl(event, event.target)
  );
}

export function HotkeyProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new HotkeyRegistry());

  useEffect(() => {
    let buffer: BufferedStep[] = [];

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyDown(event)) return;
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
