'use client';

import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '@/lib/cn.ts';

export interface SeparatorProps {
  readonly orientation?: 'horizontal' | 'vertical';
  readonly decorative?: boolean;
  readonly className?: string;
}

export function Separator({
  orientation = 'horizontal',
  decorative = true,
  className,
}: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative={decorative}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  );
}
