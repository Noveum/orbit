'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn.ts';
import { prefersReducedMotion } from './doc-scroll.ts';
import type { DocHeading } from './outline.ts';

export interface DocOutlineProps {
  readonly headings: readonly DocHeading[];
  readonly activeId: string | null;
  readonly onSelect?: (index: number) => void;
}

export function DocOutline({ headings, activeId, onSelect }: DocOutlineProps) {
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
        {headings.map((heading, index) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              data-heading={heading.id}
              onClick={
                onSelect === undefined
                  ? undefined
                  : (event) => {
                      event.preventDefault();
                      onSelect(index);
                    }
              }
              aria-current={activeId === heading.id ? 'location' : undefined}
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
