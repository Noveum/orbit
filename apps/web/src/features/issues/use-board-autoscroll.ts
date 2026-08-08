'use client';

import { useEffect } from 'react';
import { prefersReducedMotion } from '@/lib/use-media-query.ts';

const EDGE = 72;
const MAX_STEP = 18;
const RESOLVE_AFTER_PX = 24;

export function scrollStep(distance: number, edge = EDGE, maxStep = MAX_STEP): number {
  if (distance >= edge) return 0;
  const closeness = Math.min(Math.max((edge - distance) / edge, 0), 1);
  return Math.ceil(closeness * maxStep);
}

function scrollableUnder(node: Element | null): HTMLElement | null {
  let cursor: Element | null = node;
  while (cursor !== null) {
    if (cursor instanceof HTMLElement) {
      const style = window.getComputedStyle(cursor);
      const scrolls = /auto|scroll/.test(`${style.overflowY}${style.overflowX}`);
      const overflows =
        cursor.scrollHeight > cursor.clientHeight || cursor.scrollWidth > cursor.clientWidth;
      if (scrolls && overflows) return cursor;
    }
    cursor = cursor.parentElement;
  }
  return null;
}

interface Lane {
  readonly node: HTMLElement;
  readonly box: DOMRect;
}

function lanesUnder(x: number, y: number): Lane[] {
  const lanes: Lane[] = [];
  let node = scrollableUnder(document.elementFromPoint(x, y));
  while (node !== null) {
    lanes.push({ node, box: node.getBoundingClientRect() });
    node = scrollableUnder(node.parentElement);
  }
  return lanes;
}

export function useBoardAutoScroll(active: boolean): void {
  useEffect(() => {
    if (!active || prefersReducedMotion()) return;

    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    let resolvedAt: { x: number; y: number } | null = null;
    let lanes: Lane[] = [];

    const track = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };

    const stale = (at: { x: number; y: number }) =>
      resolvedAt === null ||
      Math.abs(at.x - resolvedAt.x) > RESOLVE_AFTER_PX ||
      Math.abs(at.y - resolvedAt.y) > RESOLVE_AFTER_PX;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const at = pointer;
      if (at === null) return;
      if (stale(at)) {
        lanes = lanesUnder(at.x, at.y);
        resolvedAt = at;
      }
      for (const lane of lanes) {
        const down = scrollStep(lane.box.bottom - at.y);
        const up = scrollStep(at.y - lane.box.top);
        const right = scrollStep(lane.box.right - at.x);
        const left = scrollStep(at.x - lane.box.left);
        const moved =
          scrollBy(lane.node, 'scrollTop', down - up) ||
          scrollBy(lane.node, 'scrollLeft', right - left);
        if (moved) return;
      }
    };

    window.addEventListener('pointermove', track);
    document.body.classList.add('cursor-grabbing');
    frame = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('pointermove', track);
      document.body.classList.remove('cursor-grabbing');
      cancelAnimationFrame(frame);
    };
  }, [active]);
}

function scrollBy(node: HTMLElement, axis: 'scrollTop' | 'scrollLeft', delta: number): boolean {
  if (delta === 0) return false;
  const before = node[axis];
  node[axis] = before + delta;
  return node[axis] !== before;
}
