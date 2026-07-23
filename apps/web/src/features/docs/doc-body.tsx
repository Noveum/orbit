'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn.ts';
import type { DocHeading } from './outline.ts';

export const docProseClassName = cn(
  'prose-orbit max-w-none text-base text-muted leading-7',
  '[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:font-semibold [&_h1]:text-text [&_h1]:text-xl',
  '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:scroll-mt-24 [&_h2]:font-semibold [&_h2]:text-lg [&_h2]:text-text',
  '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:scroll-mt-24 [&_h3]:font-medium [&_h3]:text-base [&_h3]:text-text',
  '[&_p]:my-4',
  '[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-semibold [&_strong]:text-text',
  '[&_blockquote]:my-4 [&_blockquote]:border-border-strong [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted',
  '[&_hr]:my-8 [&_hr]:border-border',
  '[&_code]:rounded-sm [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-text',
  '[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-2 [&_pre]:p-4 [&_pre]:text-dense',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1',
  '[&_ul:has(input)]:list-none [&_ul:has(input)]:pl-0',
  '[&_li:has(input)]:flex [&_li:has(input)]:items-start [&_li:has(input)]:gap-2',
  '[&_input[type=checkbox]]:mt-1.5 [&_input[type=checkbox]]:size-3.5 [&_input[type=checkbox]]:accent-[var(--color-accent)]',
  '[&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:text-dense',
  '[&_th]:border [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-text',
  '[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
  '[&_img]:my-5 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border',
);

export interface DocBodyProps {
  readonly html: string;
  readonly headings: readonly DocHeading[];
  readonly onActiveHeading?: (id: string) => void;
  readonly className?: string;
}

export function DocBody({ html, headings, onActiveHeading, className }: DocBodyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const notify = useRef(onActiveHeading);
  notify.current = onActiveHeading;

  // biome-ignore lint/correctness/useExhaustiveDependencies: html is a dependency because React replaces every heading node when it changes
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;

    const nodes = [...root.querySelectorAll('h1, h2, h3')];
    nodes.forEach((node, index) => {
      const heading = headings[index];
      if (heading !== undefined) node.id = heading.id;
    });

    if (notify.current === undefined || nodes.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = headings.find((heading) => visible.has(heading.id));
        if (first !== undefined) notify.current?.(first.id);
      },
      { rootMargin: '-72px 0px -60% 0px', threshold: 0 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [html, headings]);

  return (
    <div
      ref={ref}
      data-testid="doc-body"
      className={cn(docProseClassName, className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown is sanitized by @orbit/services/markdown
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
