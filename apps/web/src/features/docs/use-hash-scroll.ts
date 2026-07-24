'use client';

import { useEffect } from 'react';
import { prefersReducedMotion } from './use-scroll-spy.ts';

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
  const target = document.getElementById(id);
  if (target === null) return;
  target.scrollIntoView({
    block: 'start',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

export function useHashScroll(readySignature: string): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: readySignature is a readiness token, re-run the scroll once the rendered headings change so a deep link lands after the content mounts
  useEffect(() => {
    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => window.removeEventListener('hashchange', scrollToHash);
  }, [readySignature]);
}
