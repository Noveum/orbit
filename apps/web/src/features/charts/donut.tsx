'use client';

import { cn } from '@/lib/cn.ts';
import { useDrawOnMount } from './use-draw-on-mount.ts';

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function completionRatio(completed: number, scope: number): number {
  if (scope <= 0) return 0;
  return Math.min(1, Math.max(0, completed / scope));
}

export interface DonutProps {
  readonly completed: number;
  readonly scope: number;
  readonly className?: string;
}

export function Donut({ completed, scope, className }: DonutProps) {
  const ratio = completionRatio(completed, scope);
  const ref = useDrawOnMount<SVGCircleElement>();
  const percent = Math.round(ratio * 100);

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <svg viewBox="0 0 24 24" className="size-4.5 -rotate-90" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth="3"
        />
        <circle
          ref={ref}
          cx="12"
          cy="12"
          r={RADIUS}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(CIRCUMFERENCE * ratio).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
        />
      </svg>
      <span className="text-2xs text-muted tabular">{percent}%</span>
    </span>
  );
}

export interface ProgressBarProps {
  readonly completed: number;
  readonly scope: number;
  readonly label: string;
}

export function ProgressBar({ completed, scope, label }: ProgressBarProps) {
  const percent = Math.round(completionRatio(completed, scope) * 100);
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-accent transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-orbit)]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
