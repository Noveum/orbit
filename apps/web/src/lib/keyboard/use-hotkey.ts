'use client';

import { useEffect, useId, useRef } from 'react';
import { useHotkeyRegistry } from './provider.tsx';
import { HOTKEY_PRIORITY, type HotkeyScope, type HotkeySection } from './registry.ts';

export interface HotkeyOptions {
  readonly label: string;
  readonly section?: HotkeySection;
  readonly scope?: HotkeyScope;
  readonly priority?: number;
  readonly enabled?: boolean;
  readonly advertised?: boolean;
  readonly preventDefault?: boolean;
  readonly allowInInput?: boolean;
}

export function useHotkey(
  binding: string,
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions,
): void {
  const registry = useHotkeyRegistry();
  const handlerRef = useRef(handler);
  const {
    label,
    section = 'General',
    scope = 'global',
    priority = HOTKEY_PRIORITY.global,
    enabled = true,
    advertised = true,
    preventDefault = true,
    allowInInput = false,
  } = options;

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const id = useId();

  useEffect(
    () =>
      registry.register({
        id,
        binding,
        label,
        section,
        scope,
        priority,
        enabled,
        advertised,
        preventDefault,
        allowInInput,
        run: (event) => handlerRef.current(event),
      }),
    [
      registry,
      id,
      binding,
      label,
      section,
      scope,
      priority,
      enabled,
      advertised,
      preventDefault,
      allowInInput,
    ],
  );
}
