'use client';

import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { type RefObject, useCallback, useEffect, useState } from 'react';
import { prefersReducedMotion } from './doc-scroll.ts';
import { activeHeadingId, headingAt, headingElementsIn } from './editor-outline.ts';
import type { DocHeading, OutlineMemo } from './outline.ts';
import { EMPTY_OUTLINE, extractHeadings, outlineFor } from './outline.ts';

export interface EditorOutline {
  readonly headings: readonly DocHeading[];
  readonly activeId: string | null;
  readonly goTo: (index: number) => void;
}

function buildOutline(source: string): readonly DocHeading[] {
  return extractHeadings(renderMarkdownWithHeadingIds(source));
}

export function useEditorOutline(
  content: string,
  scroller: RefObject<HTMLElement | null>,
): EditorOutline {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [memo, setMemo] = useState<OutlineMemo>(EMPTY_OUTLINE);
  const current = outlineFor(memo, content, buildOutline);
  if (current !== memo) setMemo(current);
  const headings = current.headings;

  useEffect(() => {
    const container = scroller.current;
    if (container === null || headings.length === 0) {
      setActiveId(null);
      return;
    }

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const tops = headingElementsIn(container).map((node) => node.offsetTop);
      setActiveId(activeHeadingId(headings, tops, container.scrollTop));
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    container.addEventListener('scroll', schedule, { passive: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      container.removeEventListener('scroll', schedule);
    };
  }, [headings, scroller]);

  const goTo = useCallback(
    (index: number) => {
      const target = headingAt(scroller.current, index);
      if (target === null) return;
      target.scrollIntoView({
        block: 'start',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    },
    [scroller],
  );

  return { headings, activeId, goTo };
}
