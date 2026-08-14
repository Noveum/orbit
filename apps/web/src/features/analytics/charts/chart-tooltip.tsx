import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn.ts';

interface ChartTooltipProps {
  readonly label: string;
  readonly series: string;
  readonly value: string;
  readonly className?: string;
  readonly style?: CSSProperties | undefined;
}

export function ChartTooltip({ label, series, value, className, style }: ChartTooltipProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-2 left-2 z-10 rounded-md border border-border bg-surface px-2.5 py-2 text-xs shadow-pop',
        className,
      )}
      role="tooltip"
      style={style}
    >
      <p className="text-faint">{label}</p>
      <p className="mt-0.5 font-medium text-text">
        {series} {value}
      </p>
    </div>
  );
}
