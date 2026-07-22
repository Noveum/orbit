'use client';

import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/cn.ts';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly ref?: Ref<HTMLInputElement>;
}

export function Input({ className, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-dense text-text',
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
