import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn.ts';

interface ChartTooltipRow {
  readonly id: string;
  readonly series: string;
  readonly value: string;
}

interface ChartTooltipSingleProps {
  readonly label: string;
  readonly series: string;
  readonly value: string;
  readonly rows?: undefined;
  readonly className?: string;
  readonly style?: CSSProperties | undefined;
}

interface ChartTooltipRowsProps {
  readonly label: string;
  readonly series?: undefined;
  readonly value?: undefined;
  readonly rows: readonly ChartTooltipRow[];
  readonly className?: string;
  readonly style?: CSSProperties | undefined;
}

type ChartTooltipProps = ChartTooltipRowsProps | ChartTooltipSingleProps;

export function ChartTooltip(props: ChartTooltipProps) {
  const { label, className, style } = props;
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
      {props.rows === undefined ? (
        <p className="mt-0.5 font-medium text-text">
          {props.series} {props.value}
        </p>
      ) : (
        <div className="mt-0.5 grid gap-0.5">
          {props.rows.map((row) => (
            <p className="font-medium text-text" key={row.id}>
              {row.series} {row.value}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
