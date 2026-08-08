'use client';

import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn.ts';
import { codeHighlightClassName } from './code-theme.ts';
import type { DocHeading } from './outline.ts';
import { extractHeadings, sameHeadings } from './outline.ts';

export const docProseClassName = cn(
  'prose-orbit max-w-none break-words text-base text-muted leading-7',
  '[&_h1]:mt-10 [&_h1]:mb-3 [&_h1]:scroll-mt-24 [&_h1]:font-semibold [&_h1]:text-text [&_h1]:text-xl [&_h1]:tracking-tight',
  '[&_h2]:mt-9 [&_h2]:mb-2.5 [&_h2]:scroll-mt-24 [&_h2]:font-semibold [&_h2]:text-lg [&_h2]:text-text [&_h2]:tracking-tight',
  '[&_h3]:mt-7 [&_h3]:mb-2 [&_h3]:scroll-mt-24 [&_h3]:font-medium [&_h3]:text-base [&_h3]:text-text',
  '[&_h4]:mt-6 [&_h4]:mb-1.5 [&_h4]:scroll-mt-24 [&_h4]:font-medium [&_h4]:text-dense [&_h4]:text-text',
  '[&>:first-child]:mt-0',
  '[&_h1+*]:mt-0 [&_h2+*]:mt-0 [&_h3+*]:mt-0 [&_h4+*]:mt-0',
  '[&_p]:my-4',
  '[&_a]:text-accent [&_a]:underline [&_a]:decoration-accent/40 [&_a]:underline-offset-2',
  '[&_a]:transition-colors [&_a]:duration-[var(--duration-fast)] hover:[&_a]:decoration-accent motion-reduce:[&_a]:transition-none',
  '[&_strong]:font-semibold [&_strong]:text-text',
  '[&_u]:underline [&_u]:underline-offset-2',
  '[&_mark]:rounded-[0.2em] [&_mark]:bg-warning/25 [&_mark]:px-0.5 [&_mark]:text-text',
  '[&_blockquote]:my-5 [&_blockquote]:border-accent/40 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted [&_blockquote]:italic',
  '[&_blockquote_p]:my-2',
  '[&_blockquote>p:first-child>strong:first-child]:text-accent [&_blockquote>p:first-child>strong:first-child]:not-italic',
  '[&_hr]:my-9 [&_hr]:border-border',
  '[&_code]:rounded-sm [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-text',
  '[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-2 [&_pre]:p-4 [&_pre]:text-dense [&_pre]:leading-6',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:pl-1',
  '[&_li>ul]:my-1 [&_li>ol]:my-1',
  '[&_li::marker]:text-faint',
  '[&_ul:has(input)]:list-none [&_ul:has(input)]:pl-0',
  '[&_li:has(input)]:flex [&_li:has(input)]:items-start [&_li:has(input)]:gap-2 [&_li:has(input)]:pl-0',
  '[&_input[type=checkbox]]:mt-1.5 [&_input[type=checkbox]]:size-3.5 [&_input[type=checkbox]]:accent-[var(--color-accent)]',
  '[&_table]:my-0 [&_table]:w-full [&_table]:border-collapse [&_table]:text-dense',
  '[&_th]:border [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-text',
  '[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
  '[&_th[align=center]]:text-center [&_th[align=right]]:text-right',
  '[&_td[align=center]]:text-center [&_td[align=right]]:text-right',
  '[&_[data-table-scroll]]:my-5 [&_[data-table-scroll]]:overflow-x-auto [&_[data-table-scroll]]:rounded-lg [&_[data-table-scroll]]:border [&_[data-table-scroll]]:border-border',
  '[&_[data-table-scroll]_th]:sticky [&_[data-table-scroll]_th]:top-0 [&_[data-table-scroll]_th]:z-10',
  '[&_[data-table-scroll]_th]:border-t-0 [&_[data-table-scroll]_tr>:first-child]:border-l-0 [&_[data-table-scroll]_tr>:last-child]:border-r-0',
  '[&_[data-table-scroll]_tbody_tr:last-child_td]:border-b-0',
  '[&_[data-code-block]]:group/code [&_[data-code-block]]:relative',
  '[&_[data-code-language]]:after:pointer-events-none [&_[data-code-language]]:after:absolute [&_[data-code-language]]:after:top-3 [&_[data-code-language]]:after:right-3 [&_[data-code-language]]:after:font-mono [&_[data-code-language]]:after:text-2xs [&_[data-code-language]]:after:text-faint [&_[data-code-language]]:after:content-[attr(data-code-language)]',
  'group-hover/code:[&_[data-code-language]]:after:opacity-0',
  '[&_[data-code-copy]]:absolute [&_[data-code-copy]]:top-2 [&_[data-code-copy]]:right-2 [&_[data-code-copy]]:cursor-pointer [&_[data-code-copy]]:rounded-sm [&_[data-code-copy]]:border [&_[data-code-copy]]:border-border [&_[data-code-copy]]:bg-surface [&_[data-code-copy]]:px-1.5 [&_[data-code-copy]]:py-0.5 [&_[data-code-copy]]:text-2xs [&_[data-code-copy]]:text-muted',
  '[&_[data-code-copy]]:opacity-0 [&_[data-code-copy]]:transition-opacity [&_[data-code-copy]]:duration-[var(--duration-fast)] group-hover/code:[&_[data-code-copy]]:opacity-100 focus-visible:[&_[data-code-copy]]:opacity-100 motion-reduce:[&_[data-code-copy]]:transition-none',
  '[&_figure]:my-5 [&_figcaption]:mt-1.5 [&_figcaption]:text-2xs [&_figcaption]:text-faint',
  '[&_img]:my-5 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border',
  codeHighlightClassName,
);

export interface DocBodyProps {
  readonly html: string;
  readonly onHeadings?: (headings: DocHeading[]) => void;
  readonly className?: string;
}

export const COPY_LABEL = 'Copy';
export const COPIED_LABEL = 'Copied';

export function addCodeCopyButtons(root: HTMLElement): void {
  for (const block of root.querySelectorAll('[data-code-block]')) {
    if (block.querySelector('[data-code-copy]') !== null) continue;
    const code = block.querySelector('code');
    if (code === null) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = COPY_LABEL;
    button.setAttribute('data-code-copy', '');
    button.setAttribute('aria-label', 'Copy the code');

    button.addEventListener('click', () => {
      navigator.clipboard
        .writeText(code.textContent ?? '')
        .then(() => {
          button.textContent = COPIED_LABEL;
          setTimeout(() => {
            button.textContent = COPY_LABEL;
          }, 1500);
        })
        .catch(() => undefined);
    });

    block.append(button);
  }
}

export function DocBody({ html, onHeadings, className }: DocBodyProps) {
  const notify = useRef(onHeadings);
  const previous = useRef<DocHeading[]>([]);
  const root = useRef<HTMLDivElement | null>(null);
  notify.current = onHeadings;

  const headings = useMemo(() => extractHeadings(html), [html]);

  useEffect(() => {
    if (notify.current === undefined) return;
    if (sameHeadings(headings, previous.current)) return;
    previous.current = headings;
    notify.current(headings);
  }, [headings]);

  useEffect(() => {
    if (root.current !== null) addCodeCopyButtons(root.current);
  });

  return (
    <div
      ref={root}
      data-testid="doc-body"
      className={cn(docProseClassName, className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown is sanitized by @orbit/services/markdown
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
