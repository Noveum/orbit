'use client';

import { DEFAULT_ESTIMATE_SCALE } from '@orbit/shared/constants';
import { useId } from 'react';
import { cn } from '@/lib/cn.ts';

const TRIANGLE = 'M7 2.1 12.6 11.9a0.8 0.8 0 0 1-0.7 1.2H2.1a0.8 0.8 0 0 1-0.7-1.2Z';

export function estimateLabel(points: number | null): string {
  if (points === null) return 'No estimate';
  return points === 1 ? '1 point' : `${points} points`;
}

function fillFraction(points: number): number {
  const steps = DEFAULT_ESTIMATE_SCALE.length - 1;
  if (steps <= 0) return points > 0 ? 1 : 0;
  const exact = DEFAULT_ESTIMATE_SCALE.findIndex((entry) => entry === points);
  const rank =
    exact === -1 ? DEFAULT_ESTIMATE_SCALE.filter((entry) => entry <= points).length - 1 : exact;
  return Math.min(Math.max(rank, 0) / steps, 1);
}

export interface EstimateGlyphProps {
  readonly points: number | null;
  readonly className?: string;
}

export function EstimateGlyph({ points, className }: EstimateGlyphProps) {
  const clipId = useId();
  const fraction = points === null ? 0 : fillFraction(points);

  return (
    <svg
      viewBox="0 0 14 14"
      className={cn('size-3.5 shrink-0 text-muted', className)}
      role="img"
      aria-label={estimateLabel(points)}
    >
      <clipPath id={clipId}>
        <rect x="0" y="0" width={14 * fraction} height="14" />
      </clipPath>
      <path
        d={TRIANGLE}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeDasharray={points === null ? '2 2' : undefined}
        opacity={points === null ? 0.7 : 1}
      />
      {fraction > 0 ? <path d={TRIANGLE} fill="currentColor" clipPath={`url(#${clipId})`} /> : null}
    </svg>
  );
}
