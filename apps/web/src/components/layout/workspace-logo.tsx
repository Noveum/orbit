'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/cn.ts';

export interface WorkspaceLogoProps {
  readonly name: string;
  readonly logo?: string | null | undefined;
  readonly size?: 'sm' | 'md' | undefined;
  readonly className?: string | undefined;
}

export function WorkspaceLogo({ name, logo, size = 'md', className }: WorkspaceLogoProps) {
  const normalizedLogo = logo?.trim() ? logo.trim() : null;

  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-sm select-none',
        size === 'sm' ? 'size-4' : 'size-5',
        className,
      )}
    >
      {normalizedLogo ? (
        <AvatarPrimitive.Image src={normalizedLogo} alt="" className="size-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback
        className={cn(
          'flex size-full items-center justify-center font-semibold',
          size === 'sm'
            ? 'bg-surface-2 text-[9px] text-muted'
            : 'bg-accent text-2xs text-accent-contrast',
        )}
      >
        {name.slice(0, 1).toUpperCase()}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
