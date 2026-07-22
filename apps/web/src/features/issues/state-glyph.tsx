'use client';

import { cn } from '@/lib/cn.ts';

const COMPLETION: Record<string, number> = {
  triage: 0,
  backlog: 0,
  unstarted: 0,
  started: 0.5,
  review: 0.75,
  completed: 1,
  canceled: 1,
};

export interface StateGlyphProps {
  readonly category: string;
  readonly color: string;
  readonly className?: string;
  readonly title?: string;
}

export function StateGlyph({ category, color, className, title }: StateGlyphProps) {
  const progress = COMPLETION[category] ?? 0;
  const dashed = category === 'backlog' || category === 'triage';
  const radius = 5;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      viewBox="0 0 14 14"
      className={cn('size-3.5 shrink-0', className)}
      role="img"
      aria-label={title ?? category}
      style={{ color }}
    >
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={dashed ? '2 2' : undefined}
        opacity={category === 'canceled' ? 0.5 : 1}
      />
      {progress > 0 && category !== 'canceled' ? (
        <circle
          cx="7"
          cy="7"
          r={radius / 2}
          fill="none"
          stroke="currentColor"
          strokeWidth={radius}
          strokeDasharray={`${(circumference / 2) * progress} ${circumference}`}
          transform="rotate(-90 7 7)"
        />
      ) : null}
      {category === 'completed' ? (
        <path
          d="M4.6 7.2 6.3 8.9 9.5 5.4"
          fill="none"
          stroke="var(--color-bg)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {category === 'canceled' ? (
        <path
          d="M5 5 9 9 M9 5 5 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.7"
        />
      ) : null}
    </svg>
  );
}
