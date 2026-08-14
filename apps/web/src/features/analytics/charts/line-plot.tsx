'use client';

import type { AnalyticsDrilldownCohort } from '@orbit/shared/validators';
import { useState } from 'react';
import { chartX, chartY } from '@/features/charts/geometry.ts';
import { type AnalyticsDataRow, AnalyticsDataTable } from './analytics-data-table.tsx';
import { ChartTooltip } from './chart-tooltip.tsx';
import { PlotFrame } from './plot-frame.tsx';
import { PlotGuides } from './plot-guides.tsx';

const WIDTH = 320;
const HEIGHT = 132;
const PLOT_HEIGHT = 116;

export interface PlotPoint {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly cohort: AnalyticsDrilldownCohort;
  readonly x?: number;
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
  readonly onActivate?: (cohort: AnalyticsDrilldownCohort) => void;
  readonly valueFormatter?: (value: number) => string;
}

function pointAt(series: readonly PlotSeries[], active: ActivePoint | null): PlotPoint | null {
  if (active === null) return null;
  return series[active.seriesIndex]?.points[active.pointIndex] ?? null;
}

function announcementOf(
  series: readonly PlotSeries[],
  active: ActivePoint | null,
  valueFormatter: (value: number) => string,
): string {
  const point = pointAt(series, active);
  const activeSeries = active === null ? undefined : series[active.seriesIndex];
  return point === null || activeSeries === undefined
    ? ''
    : `${point.label}, ${activeSeries.label} ${valueFormatter(point.value)}`;
}

function tooltipStyle(x: number | null, y: number | null) {
  if (x === null || y === null) return undefined;
  return {
    left: `${(x / WIDTH) * 100}%`,
    top: `${(y / HEIGHT) * 100}%`,
    transform: x > WIDTH / 2 ? 'translate(-100%, -110%)' : 'translate(0, -110%)',
  };
}

export function LinePlot({ label, series, onActivate, valueFormatter = String }: LinePlotProps) {
  const [active, setActive] = useState<ActivePoint | null>(null);
  const activePoint = pointAt(series, active);
  const activeSeries = active === null ? undefined : series[active.seriesIndex];
  const max = maxValue(series);
  const explicitX = series.flatMap((entry) =>
    entry.points.flatMap((point) => (point.x === undefined ? [] : [point.x])),
  );
  const minimumX = Math.min(...explicitX);
  const maximumX = Math.max(...explicitX);
  function xForPoint(point: PlotPoint, index: number, count: number): number {
    if (point.x === undefined || explicitX.length === 0 || minimumX === maximumX) {
      return chartX(index, count);
    }
    return 6 + ((point.x - minimumX) * (WIDTH - 12)) / (maximumX - minimumX);
  }
  const activeX =
    activePoint === null || active === null || activeSeries === undefined
      ? null
      : xForPoint(activePoint, active.pointIndex, activeSeries.points.length);
  const activeY = activePoint === null ? null : chartY(activePoint.value, max, PLOT_HEIGHT);
  const pathFor = (entry: PlotSeries): string =>
    entry.points
      .map((point, index) => {
        const command = index === 0 ? 'M' : 'L';
        return `${command}${xForPoint(point, index, entry.points.length).toFixed(2)} ${chartY(point.value, max, PLOT_HEIGHT).toFixed(2)}`;
      })
      .join(' ');

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
        if (activePoint !== null) onActivate?.(activePoint.cohort);
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
      announcement={announcementOf(series, active, valueFormatter)}
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
          {...(onActivate === undefined
            ? {}
            : {
                onActivate: (row: AnalyticsDataRow) => {
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
                },
              })}
          rows={rows}
          {...(activePoint === null ? {} : { activeRowId: activePoint.id })}
        />
      }
      tooltip={
        activePoint === null || activeSeries === undefined ? null : (
          <ChartTooltip
            label={activePoint.label}
            series={activeSeries.label}
            style={tooltipStyle(activeX, activeY)}
            value={valueFormatter(activePoint.value)}
          />
        )
      }
    >
      <svg
        aria-label={label}
        className="h-52 w-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        onFocus={() => {
          if (active === null && (series[0]?.points.length ?? 0) > 0) {
            setActive({ seriesIndex: 0, pointIndex: 0 });
          }
        }}
        onClick={(event) => {
          const next = pointFromTarget(event.target);
          const point = pointAt(series, next);
          if (point !== null) onActivate?.(point.cohort);
        }}
        onKeyDown={(event) => {
          if (handleKeyDown(event.key)) event.preventDefault();
        }}
        onPointerOver={(event) => {
          const next = pointFromTarget(event.target);
          if (next !== null) setActive(next);
        }}
        onPointerLeave={() => setActive(null)}
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The SVG is the chart's single keyboard focus surface.
        tabIndex={0}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <title>{label}</title>
        <PlotGuides
          endLabel={series[0]?.points.at(-1)?.label ?? ''}
          height={HEIGHT}
          maxLabel={valueFormatter(max)}
          plotHeight={PLOT_HEIGHT}
          startLabel={series[0]?.points[0]?.label ?? ''}
          width={WIDTH}
        />
        {series.map((entry, seriesIndex) => (
          <g key={entry.id}>
            <path
              d={pathFor(entry)}
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
              const cx = xForPoint(point, pointIndex, entry.points.length);
              const cy = chartY(point.value, max, PLOT_HEIGHT);
              return (
                <g key={point.id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    data-testid={`plot-point-${point.id}`}
                    fill={`var(--analytics-series-${(seriesIndex % 4) + 1})`}
                    pointerEvents="none"
                    r={isActive ? 4 : 2.5}
                    stroke="var(--color-surface)"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    data-active={isActive ? 'true' : 'false'}
                    data-point-index={pointIndex}
                    data-series-index={seriesIndex}
                    data-testid={`plot-hit-${point.id}`}
                    fill="transparent"
                    r="8"
                    stroke="transparent"
                  />
                </g>
              );
            })}
          </g>
        ))}
        {activePoint === null || active === null ? null : (
          <line
            stroke="var(--color-border-strong)"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
            x1={
              activeSeries === undefined
                ? 0
                : xForPoint(activePoint, active.pointIndex, activeSeries.points.length)
            }
            x2={
              activeSeries === undefined
                ? 0
                : xForPoint(activePoint, active.pointIndex, activeSeries.points.length)
            }
            y1="6"
            y2={PLOT_HEIGHT - 6}
          />
        )}
      </svg>
    </PlotFrame>
  );
}

function maxValue(series: readonly PlotSeries[]): number {
  return Math.max(1, ...series.flatMap((entry) => entry.points.map((point) => point.value)));
}
