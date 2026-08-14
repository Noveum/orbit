'use client';

import type { AnalyticsDrilldownCohort } from '@orbit/shared/validators';
import { useState } from 'react';
import { chartY } from '@/features/charts/geometry.ts';
import { type AnalyticsDataRow, AnalyticsDataTable } from './analytics-data-table.tsx';
import { ChartTooltip } from './chart-tooltip.tsx';
import type { PlotPoint } from './line-plot.tsx';
import { PlotFrame } from './plot-frame.tsx';
import { PlotGuides } from './plot-guides.tsx';

interface BarPlotProps {
  readonly label: string;
  readonly points: readonly PlotPoint[];
  readonly onActivate?: (cohort: AnalyticsDrilldownCohort) => void;
  readonly valueFormatter?: (value: number) => string;
}

export function BarPlot({ label, points, onActivate, valueFormatter = String }: BarPlotProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activePoint = activeIndex === null ? undefined : points[activeIndex];
  const max = Math.max(1, ...points.map((point) => point.value));
  const width = 320;
  const height = 132;
  const gap = Math.min(4, width / Math.max(points.length * 3 + 1, 1));
  const barWidth = (width - gap * (points.length + 1)) / Math.max(points.length, 1);
  const rows: AnalyticsDataRow[] = points.map((point) => ({
    id: point.id,
    label: `${label} ${valueFormatter(point.value)}`,
    cells: { label: point.label, value: valueFormatter(point.value) },
  }));

  function move(index: number) {
    if (points.length === 0) return;
    setActiveIndex(Math.max(0, Math.min(index, points.length - 1)));
  }

  function indexFromTarget(target: EventTarget): number | null {
    if (!(target instanceof SVGElement)) return null;
    const index = Number(target.dataset['pointIndex']);
    return Number.isInteger(index) ? index : null;
  }

  return (
    <PlotFrame
      announcement={
        activePoint === undefined
          ? ''
          : `${activePoint.label}, ${valueFormatter(activePoint.value)}`
      }
      label={label}
      seriesLabels={[label]}
      table={
        <AnalyticsDataTable
          ariaLabel={`${label} data`}
          columns={[
            { id: 'label', label: 'Category' },
            { id: 'value', label: 'Value', align: 'right' },
          ]}
          rows={rows}
          {...(onActivate === undefined
            ? {}
            : {
                onActivate: (row: AnalyticsDataRow) => {
                  const index = points.findIndex((point) => point.id === row.id);
                  const selected = points[index];
                  if (selected !== undefined) {
                    setActiveIndex(index);
                    onActivate(selected.cohort);
                  }
                },
              })}
          {...(activePoint === undefined ? {} : { activeRowId: activePoint.id })}
        />
      }
      tooltip={
        activePoint === undefined ? null : (
          <ChartTooltip
            label={activePoint.label}
            series={label}
            style={
              activeIndex === null
                ? undefined
                : {
                    left: `${((gap + activeIndex * (barWidth + gap) + barWidth / 2) / width) * 100}%`,
                    top: `${(chartY(activePoint.value, max, height) / height) * 100}%`,
                    transform:
                      activeIndex >= points.length / 2
                        ? 'translate(-100%, -110%)'
                        : 'translate(0, -110%)',
                  }
            }
            value={valueFormatter(activePoint.value)}
          />
        )
      }
    >
      <svg
        aria-label={label}
        className="h-52 w-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={(event) => {
          const index = indexFromTarget(event.target);
          const point = index === null ? undefined : points[index];
          if (point !== undefined) onActivate?.(point.cohort);
        }}
        onFocus={() => {
          if (activeIndex === null && points.length > 0) setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') move((activeIndex ?? -1) + 1);
          else if (event.key === 'ArrowLeft') move((activeIndex ?? 1) - 1);
          else if (event.key === 'Home') move(0);
          else if (event.key === 'End') move(Number.MAX_SAFE_INTEGER);
          else if (event.key === 'Escape') setActiveIndex(null);
          else if (event.key === 'Enter' && activePoint !== undefined && onActivate !== undefined)
            onActivate(activePoint.cohort);
          else return;
          event.preventDefault();
        }}
        onPointerOver={(event) => {
          const index = indexFromTarget(event.target);
          if (index !== null) setActiveIndex(index);
        }}
        onPointerLeave={() => setActiveIndex(null)}
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The SVG is the chart's single keyboard focus surface.
        tabIndex={0}
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{label}</title>
        <PlotGuides height={height} maxLabel={valueFormatter(max)} width={width} />
        {points.map((point, index) => {
          const valueY = chartY(point.value, max, height);
          const barHeight = Math.max(2, height - 6 - valueY);
          const y = height - 6 - barHeight;
          const isActive = activeIndex === index;
          return (
            <rect
              data-active={isActive ? 'true' : 'false'}
              data-point-index={index}
              data-testid={`plot-hit-${point.id}`}
              fill={isActive ? 'var(--color-accent)' : 'var(--color-accent-soft)'}
              height={barHeight}
              key={point.id}
              rx="2"
              width={barWidth}
              x={gap + index * (barWidth + gap)}
              y={y}
            />
          );
        })}
      </svg>
    </PlotFrame>
  );
}
