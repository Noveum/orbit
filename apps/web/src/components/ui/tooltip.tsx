'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';
import { Kbd } from './kbd.tsx';

export const TOOLTIP_DELAY_MS = 400;

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={TOOLTIP_DELAY_MS} skipDelayDuration={200}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export interface TooltipProps {
  readonly label: ReactNode;
  readonly shortcut?: readonly string[];
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly align?: 'start' | 'center' | 'end';
  readonly children: ReactNode;
  readonly className?: string;
}

export function Tooltip({
  label,
  shortcut,
  side = 'right',
  align = 'center',
  children,
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-text text-xs shadow-pop',
            'data-[state=closed]:animate-pop-out data-[state=delayed-open]:animate-pop-in',
            className,
          )}
        >
          <span>{label}</span>
          {shortcut && shortcut.length > 0 ? <Kbd keys={shortcut} /> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
