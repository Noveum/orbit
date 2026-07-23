'use client';

import { useEffect, useState } from 'react';
import type { DocHeading } from './outline.ts';

export const SCROLL_SPY_OFFSET = 96;

export interface HeadingTop {
  readonly id: string;
  readonly top: number;
}

export function activeHeadingId(tops: readonly HeadingTop[], line: number): string | null {
  const first = tops[0];
  if (first === undefined) return null;
  let active = first.id;
  for (const entry of tops) {
    if (entry.top <= line) active = entry.id;
  }
  return active;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useScrollSpy(headings: readonly DocHeading[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);
  const signature = headings.map((heading) => heading.id).join('|');

  useEffect(() => {
    const ids = signature.length === 0 ? [] : signature.split('|');
    if (ids.length === 0) {
      setActiveId(null);
      return;
    }

    const liveNodes = (): HTMLElement[] =>
      ids
        .map((id) => document.getElementById(id))
        .filter((node): node is HTMLElement => node !== null);

    const update = () => {
      const tops = liveNodes().map((node) => ({
        id: node.id,
        top: node.getBoundingClientRect().top,
      }));
      if (tops.length === 0) return;
      setActiveId(activeHeadingId(tops, SCROLL_SPY_OFFSET));
    };

    update();

    const observer = new IntersectionObserver(update, {
      rootMargin: `-${SCROLL_SPY_OFFSET}px 0px 0px 0px`,
      threshold: [0, 1],
    });
    for (const node of liveNodes()) observer.observe(node);

    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };

    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);

    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    };
  }, [signature]);

  return activeId;
}
