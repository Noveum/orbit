'use client';

import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { prefersReducedMotion } from './doc-scroll.ts';
import { activeHeadingId, headingAt, headingElementsIn } from './editor-outline.ts';
import type { DocHeading } from './outline.ts';
import { extractHeadings } from './outline.ts';

export interface EditorOutline {
  readonly headings: readonly DocHeading[];
  readonly activeId: string | null;
  readonly goTo: (index: number) => void;
}

export function useEditorOutline(
  content: string,
  scroller: RefObject<HTMLElement | null>,
): EditorOutline {
  const headings = useMemo(() => extractHeadings(renderMarkdownWithHeadingIds(content)), [content]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const container = scroller.current;
    if (container === null || headings.length === 0) {
      setActiveId(null);
      return;
    }

    const measure = () => {
      const tops = headingElementsIn(container).map((node) => node.offsetTop);
      setActiveId(activeHeadingId(headings, tops, container.scrollTop));
    };

    measure();
    container.addEventListener('scroll', measure, { passive: true });
    return () => container.removeEventListener('scroll', measure);
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
