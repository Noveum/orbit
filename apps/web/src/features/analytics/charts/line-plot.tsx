'use client';

import type { AnalyticsDrilldownCohort } from '@orbit/shared/validators';
import { useState } from 'react';
import { type AnalyticsDataRow, AnalyticsDataTable } from './analytics-data-table.tsx';
import { ChartTooltip } from './chart-tooltip.tsx';
import { PlotFrame } from './plot-frame.tsx';
import { PlotGuides } from './plot-guides.tsx';

const WIDTH = 640;
const HEIGHT = 260;
const LEFT = 76;
const RIGHT = 18;
const TOP = 14;
const BOTTOM = 42;
const PLOT_BOTTOM = HEIGHT - BOTTOM;

export interface PlotPoint {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly cohort: AnalyticsDrilldownCohort;
  readonly x?: number;
  readonly available?: boolean;
}

export interface PlotSeries {
  readonly id: string;
  readonly label: string;
  readonly points: readonly PlotPoint[];
  readonly dashed?: boolean;
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
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
  readonly annotation?: string;
}

function isAvailable(point: PlotPoint | undefined): boolean {
  return point !== undefined && point.available !== false;
}

function pointAt(series: readonly PlotSeries[], active: ActivePoint | null): PlotPoint | null {
  if (active === null) return null;
  const point = series[active.seriesIndex]?.points[active.pointIndex];
  return point !== undefined && isAvailable(point) ? point : null;
}

function maxValue(series: readonly PlotSeries[]): number {
  return Math.max(
    1,
    ...series.flatMap((entry) =>
      entry.points.flatMap((point) => (isAvailable(point) ? [point.value] : [])),
    ),
  );
}

function yForValue(value: number, max: number): number {
  return PLOT_BOTTOM - (Math.max(0, value) / max) * (PLOT_BOTTOM - TOP);
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

function xTickTestId(index: number, count: number): string | undefined {
  if (index === 0) return 'plot-x-start';
  if (index === count - 1) return 'plot-x-end';
  return undefined;
}

function unavailableNote(count: number): string {
  return `${count} ${count === 1 ? 'date' : 'dates'} unavailable`;
}

function xTickLabel(label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${label}T12:00:00.000Z`));
}

export function LinePlot({
  label,
  series,
  onActivate,
  valueFormatter = String,
  xAxisLabel = 'Date',
  yAxisLabel = 'Value',
  annotation,
}: LinePlotProps) {
  const [active, setActive] = useState<ActivePoint | null>(null);
  const activePoint = pointAt(series, active);
  const activeSeries = active === null ? undefined : series[active.seriesIndex];
  const max = maxValue(series);
  const explicitX = series.flatMap((entry) =>
    entry.points.flatMap((point) => (point.x === undefined ? [] : [point.x])),
  );
  const minimumX = explicitX.length === 0 ? 0 : Math.min(...explicitX);
  const maximumX = explicitX.length === 0 ? 0 : Math.max(...explicitX);
  const plotWidth = WIDTH - LEFT - RIGHT;
  function xForPoint(point: PlotPoint, index: number, count: number): number {
    if (point.x === undefined || explicitX.length === 0 || minimumX === maximumX) {
      return count <= 1 ? LEFT + plotWidth / 2 : LEFT + (index * plotWidth) / (count - 1);
    }
    return LEFT + ((point.x - minimumX) * plotWidth) / (maximumX - minimumX);
  }
  const activeX =
    activePoint === null || active === null || activeSeries === undefined
      ? null
      : xForPoint(activePoint, active.pointIndex, activeSeries.points.length);
  const activeY = activePoint === null ? null : yForValue(activePoint.value, max);
  const pathFor = (entry: PlotSeries): string => {
    let connected = false;
    return entry.points
      .flatMap((point, index) => {
        if (!isAvailable(point)) {
          connected = false;
          return [];
        }
        const command = connected ? 'L' : 'M';
        connected = true;
        return [
          `${command}${xForPoint(point, index, entry.points.length).toFixed(2)} ${yForValue(point.value, max).toFixed(2)}`,
        ];
      })
      .join(' ');
  };

  function firstAvailable(seriesIndex: number): number {
    return Math.max(0, series[seriesIndex]?.points.findIndex((point) => isAvailable(point)) ?? 0);
  }

  function movePoint(index: number) {
    const seriesIndex = active?.seriesIndex ?? 0;
    const points = series[seriesIndex]?.points ?? [];
    if (points.length === 0) return;
    const direction = index >= (active?.pointIndex ?? -1) ? 1 : -1;
    let next = Math.max(0, Math.min(index, points.length - 1));
    while (!isAvailable(points[next]) && next >= 0 && next < points.length) next += direction;
    if (!isAvailable(points[next])) next = firstAvailable(seriesIndex);
    setActive({ seriesIndex, pointIndex: next });
  }

  function moveSeries(delta: number) {
    if (series.length === 0) return;
    const seriesIndex = Math.max(
      0,
      Math.min((active?.seriesIndex ?? 0) + delta, series.length - 1),
    );
    const preferred = active?.pointIndex ?? firstAvailable(seriesIndex);
    const pointIndex = isAvailable(series[seriesIndex]?.points[preferred])
      ? preferred
      : firstAvailable(seriesIndex);
    setActive({ seriesIndex, pointIndex });
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
    entry.points.flatMap((point) =>
      isAvailable(point)
        ? [
            {
              id: point.id,
              label: `${entry.label} ${valueFormatter(point.value)}`,
              cells: { date: point.label, series: entry.label, value: valueFormatter(point.value) },
            },
          ]
        : [],
    ),
  );
  const firstSeriesPoints = series[0]?.points ?? [];
  const axisPoints =
    explicitX.length === 0
      ? firstSeriesPoints.map((point, index) => ({
          point,
          sourceIndex: index,
          sourceCount: firstSeriesPoints.length,
        }))
      : [
          ...new Map(
            series.flatMap((entry) =>
              entry.points.flatMap((point, index) =>
                point.x === undefined
                  ? []
                  : [
                      [
                        point.x,
                        { point, sourceIndex: index, sourceCount: entry.points.length },
                      ] as const,
                    ],
              ),
            ),
          ).values(),
        ].sort((left, right) => (left.point.x ?? 0) - (right.point.x ?? 0));
  const xIndexes =
    axisPoints.length <= 2
      ? axisPoints.map((_, index) => index)
      : [0, Math.floor((axisPoints.length - 1) / 2), axisPoints.length - 1];
  const xTicks = [...new Set(xIndexes)].flatMap((index) => {
    const candidate = axisPoints[index];
    if (candidate === undefined) return [];
    const testId = xTickTestId(index, axisPoints.length);
    return [
      {
        x: xForPoint(candidate.point, candidate.sourceIndex, candidate.sourceCount),
        label: xTickLabel(candidate.point.label),
        ...(testId === undefined ? {} : { testId }),
      },
    ];
  });
  const unavailableDates = new Set(
    series.flatMap((entry) =>
      entry.points.flatMap((point) => (isAvailable(point) ? [] : [point.label])),
    ),
  );

  return (
    <PlotFrame
      announcement={announcementOf(series, active, valueFormatter)}
      dataCount={rows.length}
      label={label}
      legends={series.map((entry) => ({
        id: entry.id,
        label: entry.label,
        ...(entry.dashed === undefined ? {} : { dashed: entry.dashed }),
      }))}
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
                      if (point !== undefined && isAvailable(point)) {
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
        className="h-auto min-h-64 w-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        onFocus={() => {
          if (active === null && series.length > 0) {
            setActive({ seriesIndex: 0, pointIndex: firstAvailable(0) });
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
          bottom={BOTTOM}
          height={HEIGHT}
          left={LEFT}
          max={max}
          right={RIGHT}
          top={TOP}
          valueFormatter={valueFormatter}
          width={WIDTH}
          xAxisLabel={xAxisLabel}
          xTicks={xTicks}
          yAxisLabel={yAxisLabel}
        />
        {series.map((entry, seriesIndex) => (
          <g key={entry.id}>
            <path
              d={pathFor(entry)}
              data-testid={`plot-line-${entry.id}`}
              fill="none"
              stroke={`var(--analytics-series-${(seriesIndex % 4) + 1})`}
              strokeDasharray={entry.dashed ? '7 5' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {entry.points.map((point, pointIndex) => {
              if (!isAvailable(point)) return null;
              const isActive =
                active?.seriesIndex === seriesIndex && active.pointIndex === pointIndex;
              const cx = xForPoint(point, pointIndex, entry.points.length);
              const cy = yForValue(point.value, max);
              return (
                <g key={point.id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    data-testid={`plot-point-${point.id}`}
                    fill={`var(--analytics-series-${(seriesIndex % 4) + 1})`}
                    pointerEvents="none"
                    r={isActive ? 4 : 3}
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
                    r="10"
                    stroke="transparent"
                  />
                </g>
              );
            })}
          </g>
        ))}
        {activePoint === null || activeX === null ? null : (
          <line
            stroke="var(--color-border-strong)"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            x1={activeX}
            x2={activeX}
            y1={TOP}
            y2={PLOT_BOTTOM}
          />
        )}
      </svg>
      {annotation === undefined && unavailableDates.size === 0 ? null : (
        <p className="text-muted text-xs">{annotation ?? unavailableNote(unavailableDates.size)}</p>
      )}
    </PlotFrame>
  );
}
