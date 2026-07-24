'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn.ts';
import type { DocHeading } from './outline.ts';
import { prefersReducedMotion } from './use-scroll-spy.ts';

export interface DocOutlineProps {
  readonly headings: readonly DocHeading[];
  readonly activeId: string | null;
}

export function DocOutline({ headings, activeId }: DocOutlineProps) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (nav === null || activeId === null) return;
    const link = nav.querySelector<HTMLElement>(`[data-heading="${CSS.escape(activeId)}"]`);
    if (link === null) return;

    const navBox = nav.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();
    if (linkBox.top >= navBox.top && linkBox.bottom <= navBox.bottom) return;
    nav.scrollTo({
      top: nav.scrollTop + (linkBox.top - navBox.top) - navBox.height / 2,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [activeId]);

  if (headings.length < 2) return null;

  const jumpTo = (heading: DocHeading) => {
    const target = document.getElementById(heading.id);
    if (target === null) return;
    target.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    window.history.replaceState(null, '', `#${heading.id}`);
  };

  return (
    <nav
      ref={navRef}
      aria-label="On this page"
      data-testid="doc-outline"
      className="sticky top-6 hidden max-h-[calc(100dvh-8rem)] w-52 shrink-0 self-start overflow-y-auto pt-16 xl:block"
    >
      <p className="mb-2 pl-3 font-medium text-2xs text-faint uppercase tracking-wide">
        On this page
      </p>
      <ul className="flex flex-col">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              data-heading={heading.id}
              aria-current={activeId === heading.id ? 'location' : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                jumpTo(heading);
              }}
              className={cn(
                'block border-l py-1 text-dense transition-colors duration-[var(--duration-fast)]',
                heading.level === 1 && 'pl-3',
                heading.level === 2 && 'pl-3',
                heading.level === 3 && 'pl-6',
                activeId === heading.id
                  ? 'border-accent font-medium text-accent'
                  : 'border-border text-faint hover:text-muted',
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
