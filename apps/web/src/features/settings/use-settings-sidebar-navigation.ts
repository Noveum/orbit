'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query.ts';
import { type SettingsSection, settingsSectionsFlat } from './settings-sections.ts';
import { useSettingsNav } from './use-settings-nav.ts';

function sectionIndex(sections: readonly SettingsSection[], pathname: string): number {
  const index = sections.findIndex((section) => section.href === pathname);
  return index === -1 ? 0 : index;
}

function focusedLinkIndex(linkRefs: readonly (HTMLAnchorElement | null)[]): number {
  const active = document.activeElement;
  if (active === null) return -1;
  return linkRefs.findIndex((ref) => ref === active);
}

export interface UseSettingsSidebarNavigationOptions {
  readonly passwordEnabled: boolean;
  readonly pathname: string;
}

export function useSettingsSidebarNavigation({
  passwordEnabled,
  pathname,
}: UseSettingsSidebarNavigationOptions) {
  const { open } = useSettingsNav();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const sidebarInteractive = open || isDesktop;
  const sections = useMemo(() => settingsSectionsFlat(passwordEnabled), [passwordEnabled]);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const shouldFocusRef = useRef(false);
  const routeIndex = sectionIndex(sections, pathname);
  const [focusIndex, setFocusIndex] = useState(routeIndex);

  useEffect(() => {
    setFocusIndex(routeIndex);
  }, [routeIndex]);

  useEffect(() => {
    if (!shouldFocusRef.current) return;
    shouldFocusRef.current = false;
    linkRefs.current[focusIndex]?.focus();
  }, [focusIndex]);

  const step = useCallback(
    (direction: 1 | -1) => {
      shouldFocusRef.current = true;
      setFocusIndex((current) => {
        const fromFocused = focusedLinkIndex(linkRefs.current);
        const start = fromFocused === -1 ? current : fromFocused;
        return Math.min(Math.max(start + direction, 0), sections.length - 1);
      });
    },
    [sections.length],
  );

  const onLinkFocus = useCallback((index: number) => {
    setFocusIndex(index);
  }, []);

  useHotkey('j', () => step(1), {
    label: 'Next settings section',
    section: 'Settings',
    scope: 'settings',
    priority: HOTKEY_PRIORITY.surface,
    enabled: sidebarInteractive,
    aliases: ['down'],
  });
  useHotkey('k', () => step(-1), {
    label: 'Previous settings section',
    section: 'Settings',
    scope: 'settings',
    priority: HOTKEY_PRIORITY.surface,
    enabled: sidebarInteractive,
    aliases: ['up'],
  });

  const registerLinkRef = useCallback((index: number, node: HTMLAnchorElement | null) => {
    linkRefs.current[index] = node;
  }, []);

  return {
    sections,
    focusIndex,
    onLinkFocus,
    registerLinkRef,
  };
}
