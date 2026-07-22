'use client';

import { initialsOf } from '@orbit/shared/utils';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn.ts';

const avatarVariants = cva(
  'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-surface-2 font-medium text-muted',
  {
    variants: {
      size: {
        xs: 'size-4.5 text-[9px]',
        sm: 'size-5.5 text-2xs',
        md: 'size-7 text-xs',
        lg: 'size-9 text-dense',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  readonly name: string;
  readonly src?: string | null;
  readonly className?: string;
}

export function Avatar({ name, src, size, className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root className={cn(avatarVariants({ size }), className)}>
      {src ? (
        <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center uppercase"
      >
        {initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
