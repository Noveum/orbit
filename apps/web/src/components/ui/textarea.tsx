'use client';

import type { Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn.ts';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        'w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-dense text-text',
        'placeholder:text-faint',
        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)]',
        'hover:border-border-strong focus-visible:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
