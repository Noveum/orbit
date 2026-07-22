'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn.ts';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border border-border bg-surface-3 p-0.5',
        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)]',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-3 rounded-full bg-surface shadow-sm',
          'transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)]',
          'data-[state=checked]:translate-x-3.5',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
