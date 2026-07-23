'use client';

import { cn } from '@/lib/cn.ts';
import type { DocHeading } from './outline.ts';

export interface DocOutlineProps {
  readonly headings: readonly DocHeading[];
  readonly activeId: string | null;
}

export function DocOutline({ headings, activeId }: DocOutlineProps) {
  if (headings.length < 2) return null;

  return (
    <nav
      aria-label="On this page"
      data-testid="doc-outline"
      className="sticky top-6 hidden w-52 shrink-0 self-start pt-16 xl:block"
    >
      <p className="mb-2 pl-3 font-medium text-2xs text-faint uppercase tracking-wide">
        On this page
      </p>
      <ul className="flex flex-col">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
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
