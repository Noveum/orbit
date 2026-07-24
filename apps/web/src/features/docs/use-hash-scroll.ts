'use client';

import { useEffect } from 'react';

export function hashTargetId(hash: string): string | null {
  if (hash.length <= 1) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.length === 0) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function scrollToHash(): void {
  if (typeof window === 'undefined') return;
  const id = hashTargetId(window.location.hash);
  if (id === null) return;
  document.getElementById(id)?.scrollIntoView();
}

export function useHashScroll(readySignature: string): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: readySignature is a readiness token, re-run the scroll once the rendered headings mount so a deep link opened on a client-loaded doc still lands on its target
  useEffect(() => {
    scrollToHash();
  }, [readySignature]);
}
