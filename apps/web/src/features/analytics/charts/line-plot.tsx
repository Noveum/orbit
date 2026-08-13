'use client';

import type { AnalyticsDrilldownCohort } from '@orbit/shared/validators';
import { useState } from 'react';
import { chartX, chartY, linePath } from '@/features/charts/geometry.ts';
import { type AnalyticsDataRow, AnalyticsDataTable } from './analytics-data-table.tsx';
import { ChartTooltip } from './chart-tooltip.tsx';
import { PlotFrame } from './plot-frame.tsx';

const WIDTH = 320;
const HEIGHT = 132;

export interface PlotPoint {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly cohort: AnalyticsDrilldownCohort;
}

export interface PlotSeries {
  readonly id: string;
  readonly label: string;
  readonly points: readonly PlotPoint[];
}

interface ActivePoint {
  readonly seriesIndex: number;
  readonly pointIndex: number;
}

interface LinePlotProps {
  readonly label: string;
  readonly series: readonly PlotSeries[];
  readonly onActivate: (cohort: AnalyticsDrilldownCohort) => void;
  readonly valueFormatter?: (value: number) => string;
}

function pointAt(series: readonly PlotSeries[], active: ActivePoint | null): PlotPoint | null {
  if (active === null) return null;
  return series[active.seriesIndex]?.points[active.pointIndex] ?? null;
}

function announcementOf(series: readonly PlotSeries[], active: ActivePoint | null): string {
  const point = pointAt(series, active);
  const activeSeries = active === null ? undefined : series[active.seriesIndex];
  return point === null || activeSeries === undefined
    ? ''
    : `${point.label}, ${activeSeries.label} ${point.value}`;
}

export function LinePlot({ label, series, onActivate, valueFormatter = String }: LinePlotProps) {
  const [active, setActive] = useState<ActivePoint | null>(null);
  const activePoint = pointAt(series, active);
  const activeSeries = active === null ? undefined : series[active.seriesIndex];
  const max = Math.max(1, ...series.flatMap((entry) => entry.points.map((point) => point.value)));

  function movePoint(index: number) {
    const seriesIndex = active?.seriesIndex ?? 0;
    const count = series[seriesIndex]?.points.length ?? 0;
    if (count === 0) return;
    setActive({ seriesIndex, pointIndex: Math.max(0, Math.min(index, count - 1)) });
  }

  function moveSeries(delta: number) {
    if (series.length === 0) return;
    const seriesIndex = Math.max(
      0,
      Math.min((active?.seriesIndex ?? 0) + delta, series.length - 1),
    );
    const count = series[seriesIndex]?.points.length ?? 0;
    setActive({
      seriesIndex,
      pointIndex: Math.max(0, Math.min(active?.pointIndex ?? 0, Math.max(count - 1, 0))),
    });
  }

  function handleKeyDown(key: string): boolean {
    switch (key) {
      case 'ArrowRight':
        movePoint((active?.pointIndex ?? -1) + 1);
        return true;
      case 'ArrowLeft':
        movePoint((active?.pointIndex ?? 1) - 1);
        return true;
      case 'ArrowDown':
        moveSeries(1);
        return true;
      case 'ArrowUp':
        moveSeries(-1);
        return true;
      case 'Home':
        movePoint(0);
        return true;
      case 'End':
        movePoint(Number.MAX_SAFE_INTEGER);
        return true;
      case 'Escape':
        setActive(null);
        return true;
      case 'Enter':
        if (activePoint !== null) onActivate(activePoint.cohort);
        return true;
      default:
        return false;
    }
  }

  function pointFromTarget(target: EventTarget): ActivePoint | null {
    if (!(target instanceof SVGElement)) return null;
    const seriesIndex = Number(target.dataset['seriesIndex']);
    const pointIndex = Number(target.dataset['pointIndex']);
    return Number.isInteger(seriesIndex) && Number.isInteger(pointIndex)
      ? { seriesIndex, pointIndex }
      : null;
  }

  const rows: AnalyticsDataRow[] = series.flatMap((entry) =>
    entry.points.map((point) => ({
      id: point.id,
      label: `${entry.label} ${valueFormatter(point.value)}`,
      cells: { date: point.label, series: entry.label, value: valueFormatter(point.value) },
    })),
  );

  return (
    <PlotFrame
      announcement={announcementOf(series, active)}
      label={label}
      seriesLabels={series.map((entry) => entry.label)}
      table={
        <AnalyticsDataTable
          ariaLabel={`${label} data`}
          columns={[
            { id: 'date', label: 'Date' },
            { id: 'series', label: 'Series' },
            { id: 'value', label: 'Value', align: 'right' },
          ]}
          onActivate={(row) => {
            for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
              const pointIndex = series[seriesIndex]?.points.findIndex(
                (point) => point.id === row.id,
              );
              if (pointIndex !== undefined && pointIndex >= 0) {
                const point = series[seriesIndex]?.points[pointIndex];
                if (point !== undefined) {
                  setActive({ seriesIndex, pointIndex });
                  onActivate(point.cohort);
                }
                return;
              }
            }
          }}
          rows={rows}
          {...(activePoint === null ? {} : { activeRowId: activePoint.id })}
        />
      }
      tooltip={
        activePoint === null || activeSeries === undefined ? null : (
          <ChartTooltip
            label={activePoint.label}
            series={activeSeries.label}
            value={valueFormatter(activePoint.value)}
          />
        )
      }
    >
      <svg
        aria-label={label}
        className="h-52 w-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        onBlur={() => setActive(null)}
        onFocus={() => {
          if (active === null && (series[0]?.points.length ?? 0) > 0) {
            setActive({ seriesIndex: 0, pointIndex: 0 });
          }
        }}
        onClick={(event) => {
          const next = pointFromTarget(event.target);
          const point = pointAt(series, next);
          if (point !== null) onActivate(point.cohort);
        }}
        onKeyDown={(event) => {
          if (handleKeyDown(event.key)) event.preventDefault();
        }}
        onPointerOver={(event) => {
          const next = pointFromTarget(event.target);
          if (next !== null) setActive(next);
        }}
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The SVG is the chart's single keyboard focus surface.
        tabIndex={0}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <title>{label}</title>
        <line
          stroke="var(--color-border)"
          vectorEffect="non-scaling-stroke"
          x1="6"
          x2={WIDTH - 6}
          y1={HEIGHT - 6}
          y2={HEIGHT - 6}
        />
        {series.map((entry, seriesIndex) => (
          <g key={entry.id}>
            <path
              d={linePath(
                entry.points.map((point) => point.value),
                max,
              )}
              fill="none"
              stroke={`var(--analytics-series-${(seriesIndex % 4) + 1})`}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {entry.points.map((point, pointIndex) => {
              const isActive =
                active?.seriesIndex === seriesIndex && active.pointIndex === pointIndex;
              return (
                <circle
                  cx={chartX(pointIndex, entry.points.length)}
                  cy={chartY(point.value, max)}
                  data-active={isActive ? 'true' : 'false'}
                  data-point-index={pointIndex}
                  data-series-index={seriesIndex}
                  data-testid={`plot-hit-${point.id}`}
                  fill={
                    isActive ? `var(--analytics-series-${(seriesIndex % 4) + 1})` : 'transparent'
                  }
                  key={point.id}
                  r="7"
                  stroke={`var(--analytics-series-${(seriesIndex % 4) + 1})`}
                  strokeWidth={isActive ? 2 : 1}
                />
              );
            })}
          </g>
        ))}
        {activePoint === null || active === null ? null : (
          <line
            stroke="var(--color-border-strong)"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
            x1={chartX(active.pointIndex, activeSeries?.points.length ?? 1)}
            x2={chartX(active.pointIndex, activeSeries?.points.length ?? 1)}
            y1="6"
            y2={HEIGHT - 6}
          />
        )}
      </svg>
    </PlotFrame>
  );
}
