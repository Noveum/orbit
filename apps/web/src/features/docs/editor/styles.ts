import { cn } from '@/lib/cn.ts';

const placeholder = cn(
  '[&_.ProseMirror_p.is-empty:first-child]:before:pointer-events-none',
  '[&_.ProseMirror_p.is-empty:first-child]:before:float-left',
  '[&_.ProseMirror_p.is-empty:first-child]:before:h-0',
  '[&_.ProseMirror_p.is-empty:first-child]:before:text-faint',
  '[&_.ProseMirror_p.is-empty:first-child]:before:content-[attr(data-placeholder)]',
);

const callout = cn(
  '[&_blockquote[data-callout]]:my-4 [&_blockquote[data-callout]]:rounded-lg',
  '[&_blockquote[data-callout]]:border [&_blockquote[data-callout]]:border-l-2',
  '[&_blockquote[data-callout]]:bg-surface-2 [&_blockquote[data-callout]]:px-4 [&_blockquote[data-callout]]:py-3',
  '[&_blockquote[data-callout=note]]:border-l-accent',
  '[&_blockquote[data-callout=tip]]:border-l-success',
  '[&_blockquote[data-callout=warning]]:border-l-warning',
  '[&_blockquote[data-callout=danger]]:border-l-danger',
  '[&_blockquote[data-callout]>p]:my-1',
);

const toggle = cn(
  '[&_details]:my-4 [&_details]:rounded-lg [&_details]:border [&_details]:border-border',
  '[&_details]:bg-surface [&_details]:px-3 [&_details]:py-2',
  '[&_summary]:cursor-pointer [&_summary]:font-medium [&_summary]:text-text',
  '[&_summary]:marker:text-faint',
);

const highlighting = cn(
  '[&_.hljs-comment]:text-faint [&_.hljs-comment]:italic [&_.hljs-quote]:text-faint',
  '[&_.hljs-keyword]:text-accent [&_.hljs-selector-tag]:text-accent [&_.hljs-literal]:text-accent',
  '[&_.hljs-built_in]:text-accent [&_.hljs-meta]:text-accent',
  '[&_.hljs-string]:text-success [&_.hljs-attr]:text-success [&_.hljs-regexp]:text-success',
  '[&_.hljs-number]:text-warning [&_.hljs-symbol]:text-warning [&_.hljs-type]:text-warning',
  '[&_.hljs-title]:text-text [&_.hljs-name]:text-text [&_.hljs-section]:text-text',
  '[&_.hljs-variable]:text-danger [&_.hljs-template-variable]:text-danger',
);

export const editorSurfaceClassName = cn(
  '[&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none',
  '[&_.ProseMirror]:focus-visible:outline-none',
  '[&_.ProseMirror_.tableWrapper]:overflow-x-auto',
  '[&_.ProseMirror_.selectedCell]:bg-accent-soft',
  '[&_.ProseMirror-selectednode]:outline [&_.ProseMirror-selectednode]:outline-accent',
  placeholder,
  callout,
  toggle,
  highlighting,
);
