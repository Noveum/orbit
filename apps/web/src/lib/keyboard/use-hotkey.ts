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
  readonly aliases?: readonly string[];
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
    aliases = [],
  } = options;

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const id = useId();
  const aliasKey = aliases.join(' ');

  useEffect(() => {
    const bindings = [binding, ...aliasKey.split(' ').filter((entry) => entry.length > 0)];
    const disposers = bindings.map((entry, index) =>
      registry.register({
        id: index === 0 ? id : `${id}:${index}`,
        binding: entry,
        label,
        section,
        scope,
        priority,
        enabled,
        advertised: advertised && index === 0,
        preventDefault,
        allowInInput,
        run: (event) => handlerRef.current(event),
      }),
    );
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [
    registry,
    id,
    binding,
    aliasKey,
    label,
    section,
    scope,
    priority,
    enabled,
    advertised,
    preventDefault,
    allowInInput,
  ]);
}
