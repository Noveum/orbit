'use client';

import { cn } from '@/lib/cn.ts';
import {
  areaPath,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartY,
  linePath,
} from './geometry.ts';
import { useDrawOnMount } from './use-draw-on-mount.ts';

export type SeriesTone = 'accent' | 'success' | 'faint';

export interface ChartSeries {
  readonly id: string;
  readonly label: string;
  readonly values: readonly number[];
  readonly tone: SeriesTone;
  readonly dashed?: boolean;
  readonly filled?: boolean;
}

const STROKE: Record<SeriesTone, string> = {
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  faint: 'var(--color-faint)',
};

const LEGEND_DOT: Record<SeriesTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  faint: 'bg-faint',
};

function SeriesPath({ series, max }: { readonly series: ChartSeries; readonly max: number }) {
  const ref = useDrawOnMount<SVGPathElement>();
  return (
    <path
      ref={ref}
      d={linePath(series.values, max)}
      fill="none"
      stroke={STROKE[series.tone]}
      strokeWidth={series.dashed === true ? 1.25 : 2}
      strokeDasharray={series.dashed === true ? '4 4' : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

export interface LineChartProps {
  readonly title: string;
  readonly description: string;
  readonly series: readonly ChartSeries[];
  readonly labels: readonly string[];
  readonly max: number;
  readonly className?: string;
}

export function LineChart({ title, description, series, labels, max, className }: LineChartProps) {
  const gridValues = [0, max / 2, max];
  const firstLabel = labels.at(0) ?? '';
  const lastLabel = labels.at(-1) ?? '';

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-dense text-text">{title}</span>
        <span className="flex flex-wrap items-center gap-3">
          {series.map((entry) => (
            <span key={entry.id} className="flex items-center gap-1.5 text-2xs text-muted">
              <span
                className={cn('inline-block h-0.5 w-3 rounded-full', LEGEND_DOT[entry.tone])}
                aria-hidden="true"
              />
              {entry.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-33 w-full"
        role="img"
        aria-label={description}
      >
        <title>{description}</title>
        {gridValues.map((value) => (
          <line
            key={value}
            x1={CHART_PADDING}
            x2={CHART_WIDTH - CHART_PADDING}
            y1={chartY(value, max)}
            y2={chartY(value, max)}
            stroke="var(--color-border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series
          .filter((entry) => entry.filled === true)
          .map((entry) => (
            <path
              key={`${entry.id}-fill`}
              d={areaPath(entry.values, max)}
              fill={STROKE[entry.tone]}
              fillOpacity={0.1}
              stroke="none"
            />
          ))}
        {series.map((entry) => (
          <SeriesPath key={entry.id} series={entry} max={max} />
        ))}
      </svg>
      <div className="flex justify-between text-2xs text-faint tabular">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
    </figure>
  );
}
