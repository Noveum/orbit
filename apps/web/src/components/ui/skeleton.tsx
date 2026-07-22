'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn.ts';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-sm bg-surface-2 motion-reduce:animate-none motion-reduce:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
