'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn.ts';

export interface WorkspaceLogoProps {
  readonly name: string;
  readonly logo?: string | null | undefined;
  readonly size?: 'sm' | 'md' | undefined;
  readonly className?: string | undefined;
}

export function WorkspaceLogo({ name, logo, size = 'md', className }: WorkspaceLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const normalizedLogo = logo?.trim() ? logo.trim() : null;
  const hasError = normalizedLogo !== null && failedSrc === normalizedLogo;

  if (normalizedLogo && !hasError) {
    return (
      // biome-ignore lint/performance/noImgElement: user-supplied workspace logo image
      <img
        src={normalizedLogo}
        alt={name}
        onError={() => setFailedSrc(normalizedLogo)}
        className={cn(
          'shrink-0 rounded-sm object-cover select-none',
          size === 'sm' ? 'size-4' : 'size-5',
          className,
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-sm font-semibold select-none',
        size === 'sm'
          ? 'size-4 bg-surface-2 text-[9px] text-muted'
          : 'size-5 bg-accent text-2xs text-accent-contrast',
        className,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
