'use client';

import type { AnalyticsDrilldownCohort } from '@orbit/shared/validators';
import { useState } from 'react';
import { type AnalyticsDataRow, AnalyticsDataTable } from './analytics-data-table.tsx';
import { ChartTooltip } from './chart-tooltip.tsx';
import type { PlotPoint } from './line-plot.tsx';
import { PlotFrame } from './plot-frame.tsx';

interface BarPlotProps {
  readonly label: string;
  readonly points: readonly PlotPoint[];
  readonly onActivate?: (cohort: AnalyticsDrilldownCohort) => void;
  readonly valueFormatter?: (value: number) => string;
  readonly xAxisLabel?: string;
}

const WIDTH = 640;
const LEFT = 170;
const RIGHT = 64;
const TOP = 12;
const ROW_HEIGHT = 34;
const BOTTOM = 42;

function truncatedLabel(label: string): string {
  return label.length > 24 ? `${label.slice(0, 23)}…` : label;
}

function xTickTestId(ratio: number): string | undefined {
  if (ratio === 0) return 'plot-x-zero';
  if (ratio === 1) return 'plot-x-max';
  return undefined;
}

export function BarPlot({
  label,
  points,
  onActivate,
  valueFormatter = String,
  xAxisLabel = 'Value',
}: BarPlotProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activePoint = activeIndex === null ? undefined : points[activeIndex];
  const max = Math.max(1, ...points.map((point) => point.value));
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = Math.max(ROW_HEIGHT, points.length * ROW_HEIGHT);
  const height = TOP + plotHeight + BOTTOM;
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
      dataCount={rows.length}
      label={label}
      legends={[]}
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
        activePoint === undefined || activeIndex === null ? null : (
          <ChartTooltip
            label={activePoint.label}
            series={label}
            style={{
              left: `${((LEFT + (activePoint.value / max) * plotWidth) / WIDTH) * 100}%`,
              top: `${((TOP + activeIndex * ROW_HEIGHT + ROW_HEIGHT / 2) / height) * 100}%`,
              transform: 'translate(-100%, -110%)',
            }}
            value={valueFormatter(activePoint.value)}
          />
        )
      }
    >
      <svg
        aria-label={label}
        className="h-auto w-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
        height={height}
        onClick={(event) => {
          const index = indexFromTarget(event.target);
          const point = index === null ? undefined : points[index];
          if (point !== undefined) onActivate?.(point.cohort);
        }}
        onFocus={() => {
          if (activeIndex === null && points.length > 0) setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            move((activeIndex ?? -1) + 1);
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            move((activeIndex ?? 1) - 1);
          } else if (event.key === 'Home') move(0);
          else if (event.key === 'End') move(Number.MAX_SAFE_INTEGER);
          else if (event.key === 'Escape') setActiveIndex(null);
          else if (event.key === 'Enter' && activePoint !== undefined && onActivate !== undefined) {
            onActivate(activePoint.cohort);
          } else return;
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
        viewBox={`0 0 ${WIDTH} ${height}`}
      >
        <title>{label}</title>
        {[0, 0.5, 1].map((ratio) => {
          const x = LEFT + ratio * plotWidth;
          const value = ratio * max;
          return (
            <g key={ratio}>
              <line
                data-testid="plot-grid-line"
                stroke="var(--color-border)"
                strokeDasharray={ratio === 0 ? undefined : '3 4'}
                vectorEffect="non-scaling-stroke"
                x1={x}
                x2={x}
                y1={TOP}
                y2={TOP + plotHeight}
              />
              <text
                data-testid={xTickTestId(ratio)}
                fill="var(--color-faint)"
                fontSize="10"
                textAnchor="middle"
                x={x}
                y={TOP + plotHeight + 17}
              >
                {valueFormatter(value)}
              </text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const y = TOP + index * ROW_HEIGHT + 6;
          const barWidth = Math.max(2, (point.value / max) * plotWidth);
          const isActive = activeIndex === index;
          return (
            <g key={point.id}>
              <text
                data-testid={`plot-category-${point.id}`}
                fill="var(--color-muted)"
                fontSize="11"
                textAnchor="end"
                x={LEFT - 10}
                y={y + 15}
              >
                {truncatedLabel(point.label)}
              </text>
              <rect
                data-active={isActive ? 'true' : 'false'}
                data-point-index={index}
                data-testid={`plot-hit-${point.id}`}
                fill={isActive ? 'var(--color-accent)' : 'var(--color-accent-soft)'}
                height="22"
                rx="3"
                width={barWidth}
                x={LEFT}
                y={y}
              />
              <text
                data-testid={`plot-value-${point.id}`}
                fill="var(--color-text)"
                fontSize="11"
                fontWeight="600"
                x={Math.min(WIDTH - RIGHT + 8, LEFT + barWidth + 8)}
                y={y + 15}
              >
                {valueFormatter(point.value)}
              </text>
            </g>
          );
        })}
        <text
          data-testid="plot-x-axis-label"
          fill="var(--color-muted)"
          fontSize="11"
          fontWeight="500"
          textAnchor="middle"
          x={LEFT + plotWidth / 2}
          y={height - 2}
        >
          {xAxisLabel}
        </text>
      </svg>
    </PlotFrame>
  );
}
