'use client';

import { PRIORITY_LABELS, type Priority } from '@orbit/shared/constants';
import { cn } from '@/lib/cn.ts';

const TONE: Record<number, string> = {
  0: 'text-priority-none',
  1: 'text-priority-urgent',
  2: 'text-priority-high',
  3: 'text-priority-medium',
  4: 'text-priority-low',
};

const FILLED_BARS: Record<number, number> = { 0: 0, 1: 3, 2: 3, 3: 2, 4: 1 };

export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority as Priority] ?? 'No priority';
}

export interface PriorityGlyphProps {
  readonly priority: number;
  readonly className?: string;
}

export function PriorityGlyph({ priority, className }: PriorityGlyphProps) {
  const filled = FILLED_BARS[priority] ?? 0;
  const label = priorityLabel(priority);

  if (priority === 1) {
    return (
      <svg
        viewBox="0 0 14 14"
        className={cn('size-3.5 shrink-0 text-priority-urgent', className)}
        role="img"
        aria-label={label}
      >
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <rect x="6.4" y="3.4" width="1.3" height="4.6" rx="0.6" fill="var(--color-bg)" />
        <rect x="6.4" y="9.2" width="1.3" height="1.4" rx="0.6" fill="var(--color-bg)" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 14 14"
      className={cn('size-3.5 shrink-0', TONE[priority] ?? TONE[0], className)}
      role="img"
      aria-label={label}
    >
      {[0, 1, 2].map((index) => {
        const height = 4 + index * 3;
        return (
          <rect
            key={index}
            x={1.5 + index * 4}
            y={11 - height}
            width="2.6"
            height={height}
            rx="1"
            fill="currentColor"
            opacity={index < filled ? 1 : 0.28}
          />
        );
      })}
    </svg>
  );
}
