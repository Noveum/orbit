'use client';

import { useEffect } from 'react';

const EDGE = 72;
const MAX_STEP = 18;

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

export function useBoardAutoScroll(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    let frame = 0;
    let pointer: { x: number; y: number } | null = null;

    const track = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (pointer === null) return;
      const under = document.elementFromPoint(pointer.x, pointer.y);
      let node = scrollableUnder(under);
      while (node !== null) {
        const box = node.getBoundingClientRect();
        const down = scrollStep(box.bottom - pointer.y);
        const up = scrollStep(pointer.y - box.top);
        const right = scrollStep(box.right - pointer.x);
        const left = scrollStep(pointer.x - box.left);
        const moved =
          scrollBy(node, 'scrollTop', down - up) || scrollBy(node, 'scrollLeft', right - left);
        if (moved) return;
        node = scrollableUnder(node.parentElement);
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
