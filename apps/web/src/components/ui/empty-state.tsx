'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

export interface EmptyStateProps {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      {icon ? (
        <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-faint [&_svg]:size-4.5">
          {icon}
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="font-medium text-sm text-text">{title}</p>
        {description ? <p className="max-w-sm text-muted text-xs">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
