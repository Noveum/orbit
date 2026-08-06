import { cn } from '@/lib/cn.ts';

export const codeHighlightClassName = cn(
  '[&_.hljs-comment]:text-faint [&_.hljs-comment]:italic [&_.hljs-quote]:text-faint',
  '[&_.hljs-keyword]:text-accent [&_.hljs-selector-tag]:text-accent [&_.hljs-literal]:text-accent',
  '[&_.hljs-built_in]:text-accent [&_.hljs-meta]:text-accent',
  '[&_.hljs-string]:text-success [&_.hljs-attr]:text-success [&_.hljs-regexp]:text-success',
  '[&_.hljs-number]:text-warning [&_.hljs-symbol]:text-warning [&_.hljs-type]:text-warning',
  '[&_.hljs-title]:text-text [&_.hljs-name]:text-text [&_.hljs-section]:text-text',
  '[&_.hljs-variable]:text-danger [&_.hljs-template-variable]:text-danger',
);
