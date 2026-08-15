'use client';

import type { AnalyticsDrilldownCohort } from '@orbit/shared/validators';
import { useState } from 'react';
import { useMeasuredWidth } from '@/lib/use-measured-width.ts';
import type { SprintDay } from '../burn-math.ts';
import {
  type AnalyticsDataColumn,
  type AnalyticsDataRow,
  AnalyticsDataTable,
} from './analytics-data-table.tsx';
import { ChartTooltip } from './chart-tooltip.tsx';
import { PlotFrame } from './plot-frame.tsx';
import { PlotGuides } from './plot-guides.tsx';

const HEIGHT = 280;
const LEFT = 56;
const RIGHT = 16;
const TOP = 12;
const BOTTOM = 44;
const PLOT_BOTTOM = HEIGHT - BOTTOM;
const TICK_SPACING = 56;
const DOT_RADIUS = 2.5;

export interface PlotPoint {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly displayValue?: number;
  readonly cohort: AnalyticsDrilldownCohort;
  readonly x?: number;
  readonly available?: boolean;
}

export interface PlotSeries {
  readonly id: string;
  readonly label: string;
  readonly points: readonly PlotPoint[];
  readonly dashed?: boolean;
  readonly step?: boolean;
  readonly dots?: boolean;
  readonly color?: number;
}

interface ActivePoint {
  readonly seriesIndex: number;
  readonly pointIndex: number;
}

interface LinePlotProps {
  readonly label: string;
  readonly series: readonly PlotSeries[];
  readonly days?: readonly SprintDay[];
  readonly onActivate?: (cohort: AnalyticsDrilldownCohort) => void;
  readonly valueFormatter?: (value: number) => string;
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
  readonly annotation?: string;
}

type LegacyLinePlotProps = Omit<LinePlotProps, 'days'>;
type DayLinePlotProps = Omit<LinePlotProps, 'days'> & { readonly days: readonly SprintDay[] };

interface AxisTick {
  readonly x: number;
  readonly label: string;
  readonly testId?: string;
}

interface TooltipRow {
  readonly id: string;
  readonly series: string;
  readonly value: string;
}

function isAvailable(point: PlotPoint | undefined): boolean {
  return point !== undefined && point.available !== false;
}

function seriesToken(entry: PlotSeries, index: number): number {
  return entry.color ?? (index % 4) + 1;
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

function xTickLabel(label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${label}T12:00:00.000Z`));
}

function unavailableNote(count: number): string {
  return `${count} ${count === 1 ? 'date' : 'dates'} unavailable`;
}

function unavailableDates(series: readonly PlotSeries[]): ReadonlySet<string> {
  return new Set(
    series.flatMap((entry) =>
      entry.points.flatMap((point) => (isAvailable(point) ? [] : [point.label])),
    ),
  );
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1));
}

function tooltipStyle(x: number | null, y: number | null, width: number) {
  if (x === null || y === null) return undefined;
  return {
    left: `${(x / width) * 100}%`,
    top: `${(y / HEIGHT) * 100}%`,
    transform: x > width / 2 ? 'translate(-100%, -110%)' : 'translate(0, -110%)',
  };
}

function xTickTestId(index: number, count: number): string | undefined {
  if (index === 0) return 'plot-x-start';
  if (index === count - 1) return 'plot-x-end';
  return undefined;
}

function pointAt(series: readonly PlotSeries[], active: ActivePoint | null): PlotPoint | null {
  if (active === null) return null;
  const point = series[active.seriesIndex]?.points[active.pointIndex];
  return point !== undefined && isAvailable(point) ? point : null;
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

function firstAvailableIndex(points: readonly PlotPoint[]): number {
  return Math.max(
    0,
    points.findIndex((point) => isAvailable(point)),
  );
}

function lastAvailableIndex(points: readonly PlotPoint[]): number {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (isAvailable(points[index])) return index;
  }
  return Math.max(0, points.length - 1);
}

function movedPointIndex(
  points: readonly PlotPoint[],
  current: number | null,
  target: number,
): number {
  const direction = target >= (current ?? -1) ? 1 : -1;
  let next = clampIndex(target, points.length);
  while (next >= 0 && next < points.length && !isAvailable(points[next])) next += direction;
  if (isAvailable(points[next])) return next;
  return direction === 1 ? lastAvailableIndex(points) : firstAvailableIndex(points);
}

function movedPoint(
  series: readonly PlotSeries[],
  active: ActivePoint | null,
  target: number,
): ActivePoint | null {
  const seriesIndex = active?.seriesIndex ?? 0;
  const points = series[seriesIndex]?.points ?? [];
  if (points.length === 0) return active;
  return { seriesIndex, pointIndex: movedPointIndex(points, active?.pointIndex ?? null, target) };
}

function movedSeriesSelection(
  series: readonly PlotSeries[],
  active: ActivePoint | null,
  delta: number,
): ActivePoint | null {
  if (series.length === 0) return active;
  const seriesIndex = clampIndex((active?.seriesIndex ?? 0) + delta, series.length);
  const points = series[seriesIndex]?.points ?? [];
  const preferred = active?.pointIndex ?? firstAvailableIndex(points);
  const pointIndex = isAvailable(points[preferred]) ? preferred : firstAvailableIndex(points);
  return { seriesIndex, pointIndex };
}

interface LegacyKeyResult {
  readonly active: ActivePoint | null;
  readonly activate: boolean;
}

function legacyKeyResult(
  key: string,
  series: readonly PlotSeries[],
  active: ActivePoint | null,
): LegacyKeyResult | null {
  switch (key) {
    case 'ArrowRight':
      return {
        active: movedPoint(series, active, (active?.pointIndex ?? -1) + 1),
        activate: false,
      };
    case 'ArrowLeft':
      return { active: movedPoint(series, active, (active?.pointIndex ?? 1) - 1), activate: false };
    case 'ArrowDown':
      return { active: movedSeriesSelection(series, active, 1), activate: false };
    case 'ArrowUp':
      return { active: movedSeriesSelection(series, active, -1), activate: false };
    case 'Home':
      return { active: movedPoint(series, active, 0), activate: false };
    case 'End':
      return { active: movedPoint(series, active, Number.MAX_SAFE_INTEGER), activate: false };
    case 'Escape':
      return { active: null, activate: false };
    case 'Enter':
      return { active, activate: true };
    default:
      return null;
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

function findPointForRow(series: readonly PlotSeries[], rowId: string): ActivePoint | null {
  for (const [seriesIndex, entry] of series.entries()) {
    const pointIndex = entry.points.findIndex((point) => point.id === rowId);
    if (pointIndex >= 0) {
      return isAvailable(entry.points[pointIndex]) ? { seriesIndex, pointIndex } : null;
    }
  }
  return null;
}

interface ExplicitXRange {
  readonly values: readonly number[];
  readonly minimumX: number;
  readonly maximumX: number;
}

function explicitXRange(series: readonly PlotSeries[]): ExplicitXRange {
  const values = series.flatMap((entry) =>
    entry.points.flatMap((point) => (point.x === undefined ? [] : [point.x])),
  );
  return {
    values,
    minimumX: values.length === 0 ? 0 : Math.min(...values),
    maximumX: values.length === 0 ? 0 : Math.max(...values),
  };
}

function legacyXForPoint(
  point: PlotPoint,
  index: number,
  count: number,
  range: ExplicitXRange,
  plotWidth: number,
): number {
  if (point.x === undefined || range.values.length === 0 || range.minimumX === range.maximumX) {
    return count <= 1 ? LEFT + plotWidth / 2 : LEFT + (index * plotWidth) / (count - 1);
  }
  return LEFT + ((point.x - range.minimumX) * plotWidth) / (range.maximumX - range.minimumX);
}

function legacyPathFor(
  entry: PlotSeries,
  range: ExplicitXRange,
  plotWidth: number,
  max: number,
): string {
  let connected = false;
  return entry.points
    .flatMap((point, index) => {
      if (!isAvailable(point)) {
        connected = false;
        return [];
      }
      const command = connected ? 'L' : 'M';
      connected = true;
      const x = legacyXForPoint(point, index, entry.points.length, range, plotWidth);
      const y = yForValue(point.value, max);
      return [`${command}${x.toFixed(2)} ${y.toFixed(2)}`];
    })
    .join(' ');
}

interface AxisSource {
  readonly point: PlotPoint;
  readonly sourceIndex: number;
  readonly sourceCount: number;
}

function legacyAxisPoints(
  series: readonly PlotSeries[],
  range: ExplicitXRange,
): readonly AxisSource[] {
  const firstSeriesPoints = series[0]?.points ?? [];
  if (range.values.length === 0) {
    return firstSeriesPoints.map((point, index) => ({
      point,
      sourceIndex: index,
      sourceCount: firstSeriesPoints.length,
    }));
  }
  return [
    ...new Map(
      series.flatMap((entry) =>
        entry.points.flatMap((point, index) =>
          point.x === undefined
            ? []
            : [[point.x, { point, sourceIndex: index, sourceCount: entry.points.length }] as const],
        ),
      ),
    ).values(),
  ].sort((left, right) => (left.point.x ?? 0) - (right.point.x ?? 0));
}

function legacyTicks(
  series: readonly PlotSeries[],
  range: ExplicitXRange,
  plotWidth: number,
): readonly AxisTick[] {
  const axisPoints = legacyAxisPoints(series, range);
  const xIndexes =
    axisPoints.length <= 2
      ? axisPoints.map((_, index) => index)
      : [0, Math.floor((axisPoints.length - 1) / 2), axisPoints.length - 1];
  return [...new Set(xIndexes)].flatMap((index) => {
    const candidate = axisPoints[index];
    if (candidate === undefined) return [];
    const testId = xTickTestId(index, axisPoints.length);
    const x = legacyXForPoint(
      candidate.point,
      candidate.sourceIndex,
      candidate.sourceCount,
      range,
      plotWidth,
    );
    return [
      { x, label: xTickLabel(candidate.point.label), ...(testId === undefined ? {} : { testId }) },
    ];
  });
}

function legacyRows(
  series: readonly PlotSeries[],
  valueFormatter: (value: number) => string,
): AnalyticsDataRow[] {
  return series.flatMap((entry) =>
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
}

interface DayGeometry {
  readonly indexMap: ReadonlyMap<string, number>;
  readonly slot: number;
  readonly plotWidth: number;
}

function daySlot(width: number, dayCount: number): number {
  return (width - LEFT - RIGHT) / Math.max(1, dayCount - 1);
}

function xForDay(index: number, slot: number): number {
  return LEFT + index * slot;
}

function dayGeometryFor(days: readonly SprintDay[], width: number): DayGeometry {
  return {
    indexMap: new Map(days.map((day, index) => [day.date, index])),
    slot: daySlot(width, days.length),
    plotWidth: width - LEFT - RIGHT,
  };
}

function dayTickIndexes(days: readonly SprintDay[], plotWidth: number): readonly number[] {
  const maxLabels = Math.max(1, Math.floor(plotWidth / TICK_SPACING));
  const step = Math.max(1, Math.ceil(days.length / maxLabels));
  const stepCount = Math.ceil(days.length / step);
  const indexes = new Set(Array.from({ length: stepCount }, (_unused, index) => index * step));
  if (days.length > 0) {
    indexes.add(0);
    indexes.add(days.length - 1);
  }
  const todayIndex = days.findIndex((day) => day.today);
  if (todayIndex >= 0) indexes.add(todayIndex);
  return [...indexes].sort((left, right) => left - right);
}

function dayTicks(days: readonly SprintDay[], geometry: DayGeometry): readonly AxisTick[] {
  return dayTickIndexes(days, geometry.plotWidth).flatMap((index) => {
    const day = days[index];
    if (day === undefined) return [];
    const testId = xTickTestId(index, days.length);
    return [
      {
        x: xForDay(index, geometry.slot),
        label: xTickLabel(day.date),
        ...(testId === undefined ? {} : { testId }),
      },
    ];
  });
}

function pointXInDayMode(
  point: PlotPoint,
  index: number,
  count: number,
  geometry: DayGeometry,
): number {
  const mapped = geometry.indexMap.get(point.label);
  if (mapped !== undefined) return xForDay(mapped, geometry.slot);
  return count <= 1
    ? LEFT + geometry.plotWidth / 2
    : LEFT + (index * geometry.plotWidth) / (count - 1);
}

function dayPathFor(entry: PlotSeries, geometry: DayGeometry, max: number): string {
  let connected = false;
  return entry.points
    .flatMap((point, index) => {
      if (!isAvailable(point)) {
        connected = false;
        return [];
      }
      const x = pointXInDayMode(point, index, entry.points.length, geometry);
      const y = yForValue(point.value, max);
      if (!connected) {
        connected = true;
        return [`M${x.toFixed(2)} ${y.toFixed(2)}`];
      }
      return entry.step
        ? [`H${x.toFixed(2)}`, `V${y.toFixed(2)}`]
        : [`L${x.toFixed(2)} ${y.toFixed(2)}`];
    })
    .join(' ');
}

function isWorkingDay(point: PlotPoint, days: readonly SprintDay[]): boolean {
  const day = days.find((candidate) => candidate.date === point.label);
  return day === undefined || !day.weekend;
}

interface PlottedDot {
  readonly point: PlotPoint;
  readonly x: number;
  readonly y: number;
}

function dayDots(
  entry: PlotSeries,
  days: readonly SprintDay[],
  geometry: DayGeometry,
  max: number,
): readonly PlottedDot[] {
  if (entry.dots !== true) return [];
  return entry.points.flatMap((point, index) => {
    if (!(isAvailable(point) && isWorkingDay(point, days))) return [];
    return [
      {
        point,
        x: pointXInDayMode(point, index, entry.points.length, geometry),
        y: yForValue(point.value, max),
      },
    ];
  });
}

function tooltipRowsForDay(
  series: readonly PlotSeries[],
  day: SprintDay | undefined,
  valueFormatter: (value: number) => string,
): readonly TooltipRow[] {
  if (day === undefined) return [];
  return series.flatMap((entry) => {
    const point = entry.points.find(
      (candidate) => candidate.label === day.date && isAvailable(candidate),
    );
    return point === undefined
      ? []
      : [
          {
            id: entry.id,
            series: entry.label,
            value: valueFormatter(point.displayValue ?? point.value),
          },
        ];
  });
}

function topYForDay(
  series: readonly PlotSeries[],
  day: SprintDay | undefined,
  max: number,
): number | null {
  if (day === undefined) return null;
  const values = series.flatMap((entry) => {
    const point = entry.points.find(
      (candidate) => candidate.label === day.date && isAvailable(candidate),
    );
    return point === undefined ? [] : [point.value];
  });
  return values.length === 0 ? null : yForValue(Math.max(...values), max);
}

function announcementForDay(day: SprintDay | undefined, rows: readonly TooltipRow[]): string {
  if (day === undefined || rows.length === 0) return '';
  return `${xTickLabel(day.date)}, ${rows.map((row) => `${row.series} ${row.value}`).join(', ')}`;
}

function firstPointAtDay(
  series: readonly PlotSeries[],
  day: SprintDay | undefined,
): PlotPoint | null {
  if (day === undefined) return null;
  for (const entry of series) {
    const point = entry.points.find(
      (candidate) => candidate.label === day.date && isAvailable(candidate),
    );
    if (point !== undefined) return point;
  }
  return null;
}

function dayTableRows(
  series: readonly PlotSeries[],
  days: readonly SprintDay[],
  valueFormatter: (value: number) => string,
): AnalyticsDataRow[] {
  return days.map((day) => {
    const cells: Record<string, string> = { date: xTickLabel(day.date) };
    const parts: string[] = [];
    for (const entry of series) {
      const point = entry.points.find((candidate) => candidate.label === day.date);
      const formatted =
        point !== undefined && isAvailable(point)
          ? valueFormatter(point.displayValue ?? point.value)
          : '';
      cells[entry.id] = formatted;
      if (formatted !== '') parts.push(`${entry.label} ${formatted}`);
    }
    return {
      id: day.date,
      label:
        parts.length === 0 ? xTickLabel(day.date) : `${xTickLabel(day.date)} ${parts.join(', ')}`,
      cells,
    };
  });
}

function dayTableColumns(series: readonly PlotSeries[]): readonly AnalyticsDataColumn[] {
  return [
    { id: 'date', label: 'Date' },
    ...series.map((entry) => ({ id: entry.id, label: entry.label, align: 'right' as const })),
  ];
}

function findDayForRow(days: readonly SprintDay[], rowId: string): number | null {
  const index = days.findIndex((day) => day.date === rowId);
  return index < 0 ? null : index;
}

function dayIndexFromTarget(target: EventTarget): number | null {
  if (!(target instanceof SVGElement)) return null;
  const index = Number(target.dataset['dayIndex']);
  return Number.isInteger(index) ? index : null;
}

interface DayKeyResult {
  readonly activeDay: number | null;
  readonly activate: boolean;
}

function dayKeyResult(
  key: string,
  days: readonly SprintDay[],
  activeDay: number | null,
): DayKeyResult | null {
  switch (key) {
    case 'ArrowRight':
      return {
        activeDay: days.length === 0 ? activeDay : clampIndex((activeDay ?? -1) + 1, days.length),
        activate: false,
      };
    case 'ArrowLeft':
      return {
        activeDay:
          days.length === 0 ? activeDay : clampIndex((activeDay ?? days.length) - 1, days.length),
        activate: false,
      };
    case 'Home':
      return { activeDay: days.length === 0 ? activeDay : 0, activate: false };
    case 'End':
      return { activeDay: days.length === 0 ? activeDay : days.length - 1, activate: false };
    case 'Escape':
      return { activeDay: null, activate: false };
    case 'Enter':
      return { activeDay, activate: true };
    default:
      return null;
  }
}

function LegacyLinePlot({
  label,
  series,
  onActivate,
  valueFormatter = String,
  xAxisLabel = 'Date',
  yAxisLabel = 'Value',
  annotation,
}: LegacyLinePlotProps) {
  const { ref, width } = useMeasuredWidth();
  const [active, setActive] = useState<ActivePoint | null>(null);
  const activePoint = pointAt(series, active);
  const activeSeries = active === null ? undefined : series[active.seriesIndex];
  const max = maxValue(series);
  const range = explicitXRange(series);
  const plotWidth = width - LEFT - RIGHT;
  const activeX =
    activePoint === null || active === null || activeSeries === undefined
      ? null
      : legacyXForPoint(
          activePoint,
          active.pointIndex,
          activeSeries.points.length,
          range,
          plotWidth,
        );
  const activeY = activePoint === null ? null : yForValue(activePoint.value, max);
  const rows = legacyRows(series, valueFormatter);
  const unavailable = unavailableDates(series);
  const xTicks = legacyTicks(series, range, plotWidth);

  return (
    <PlotFrame
      announcement={announcementOf(series, active, valueFormatter)}
      dataCount={rows.length}
      label={label}
      legends={series.map((entry, index) => ({
        id: entry.id,
        label: entry.label,
        color: seriesToken(entry, index),
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
                  const next = findPointForRow(series, row.id);
                  if (next === null) return;
                  const point = series[next.seriesIndex]?.points[next.pointIndex];
                  if (point === undefined) return;
                  setActive(next);
                  onActivate(point.cohort);
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
            style={tooltipStyle(activeX, activeY, width)}
            value={valueFormatter(activePoint.value)}
          />
        )
      }
    >
      <div className="w-full" ref={ref}>
        <svg
          aria-label={label}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          height={HEIGHT}
          onClick={(event) => {
            const point = pointAt(series, pointFromTarget(event.target));
            if (point !== null) onActivate?.(point.cohort);
          }}
          onFocus={() => {
            if (active === null && series.length > 0) {
              setActive({
                seriesIndex: 0,
                pointIndex: firstAvailableIndex(series[0]?.points ?? []),
              });
            }
          }}
          onKeyDown={(event) => {
            const result = legacyKeyResult(event.key, series, active);
            if (result === null) return;
            setActive(result.active);
            if (result.activate) {
              const point = pointAt(series, result.active);
              if (point !== null) onActivate?.(point.cohort);
            }
            event.preventDefault();
          }}
          onPointerOver={(event) => {
            const next = pointFromTarget(event.target);
            if (next !== null) setActive(next);
          }}
          onPointerLeave={() => setActive(null)}
          role="application"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The SVG is the chart's single keyboard focus surface.
          tabIndex={0}
          width={width}
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
            width={width}
            xAxisLabel={xAxisLabel}
            xTicks={xTicks}
            yAxisLabel={yAxisLabel}
          />
          {series.map((entry, seriesIndex) => (
            <g key={entry.id}>
              <path
                d={legacyPathFor(entry, range, plotWidth, max)}
                data-testid={`plot-line-${entry.id}`}
                fill="none"
                stroke={`var(--analytics-series-${seriesToken(entry, seriesIndex)})`}
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
                const cx = legacyXForPoint(
                  point,
                  pointIndex,
                  entry.points.length,
                  range,
                  plotWidth,
                );
                const cy = yForValue(point.value, max);
                return (
                  <g key={point.id}>
                    <circle
                      cx={cx}
                      cy={cy}
                      data-testid={`plot-point-${point.id}`}
                      fill={`var(--analytics-series-${seriesToken(entry, seriesIndex)})`}
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
      </div>
      {annotation === undefined && unavailable.size === 0 ? null : (
        <p className="text-muted text-xs">{annotation ?? unavailableNote(unavailable.size)}</p>
      )}
    </PlotFrame>
  );
}

function DayLinePlot({
  label,
  series,
  days,
  onActivate,
  valueFormatter = String,
  xAxisLabel = 'Date',
  yAxisLabel = 'Value',
  annotation,
}: DayLinePlotProps) {
  const { ref, width } = useMeasuredWidth();
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const max = maxValue(series);
  const geometry = dayGeometryFor(days, width);
  const activeDayEntry = activeDay === null ? undefined : days[activeDay];
  const tooltipRows = tooltipRowsForDay(series, activeDayEntry, valueFormatter);
  const tableRows = dayTableRows(series, days, valueFormatter);
  const unavailable = unavailableDates(series);
  const activeX = activeDay === null ? null : xForDay(activeDay, geometry.slot);
  const activeY = topYForDay(series, activeDayEntry, max);

  return (
    <PlotFrame
      announcement={announcementForDay(activeDayEntry, tooltipRows)}
      dataCount={tableRows.length}
      label={label}
      legends={series.map((entry, index) => ({
        id: entry.id,
        label: entry.label,
        color: seriesToken(entry, index),
        ...(entry.dashed === undefined ? {} : { dashed: entry.dashed }),
      }))}
      table={
        <AnalyticsDataTable
          ariaLabel={`${label} data`}
          columns={dayTableColumns(series)}
          {...(onActivate === undefined
            ? {}
            : {
                onActivate: (row: AnalyticsDataRow) => {
                  const index = findDayForRow(days, row.id);
                  if (index === null) return;
                  const point = firstPointAtDay(series, days[index]);
                  if (point === null) return;
                  setActiveDay(index);
                  onActivate(point.cohort);
                },
              })}
          rows={tableRows}
          {...(activeDayEntry === undefined ? {} : { activeRowId: activeDayEntry.date })}
        />
      }
      tooltip={
        activeDayEntry === undefined || tooltipRows.length === 0 ? null : (
          <ChartTooltip
            label={xTickLabel(activeDayEntry.date)}
            rows={tooltipRows}
            style={tooltipStyle(activeX, activeY, width)}
          />
        )
      }
    >
      <div className="w-full" ref={ref}>
        <svg
          aria-label={label}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          height={HEIGHT}
          onClick={(event) => {
            const index = dayIndexFromTarget(event.target);
            const point = index === null ? null : firstPointAtDay(series, days[index]);
            if (point !== null) onActivate?.(point.cohort);
          }}
          onFocus={() => {
            if (activeDay === null && days.length > 0) setActiveDay(0);
          }}
          onKeyDown={(event) => {
            const result = dayKeyResult(event.key, days, activeDay);
            if (result === null) return;
            setActiveDay(result.activeDay);
            if (result.activate) {
              const day = result.activeDay === null ? undefined : days[result.activeDay];
              const point = firstPointAtDay(series, day);
              if (point !== null) onActivate?.(point.cohort);
            }
            event.preventDefault();
          }}
          onPointerOver={(event) => {
            const index = dayIndexFromTarget(event.target);
            if (index !== null) setActiveDay(index);
          }}
          onPointerLeave={() => setActiveDay(null)}
          role="application"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The SVG is the chart's single keyboard focus surface.
          tabIndex={0}
          width={width}
        >
          <title>{label}</title>
          {days.flatMap((day, index) =>
            day.weekend
              ? [
                  <rect
                    data-testid="plot-weekend-band"
                    fill="var(--color-surface-raised)"
                    height={PLOT_BOTTOM - TOP}
                    key={day.date}
                    opacity="0.5"
                    width={geometry.slot}
                    x={xForDay(index, geometry.slot) - geometry.slot / 2}
                    y={TOP}
                  />,
                ]
              : [],
          )}
          <PlotGuides
            bottom={BOTTOM}
            height={HEIGHT}
            left={LEFT}
            max={max}
            right={RIGHT}
            top={TOP}
            valueFormatter={valueFormatter}
            width={width}
            xAxisLabel={xAxisLabel}
            xTicks={dayTicks(days, geometry)}
            yAxisLabel={yAxisLabel}
          />
          {series.map((entry, seriesIndex) => (
            <g key={entry.id}>
              <path
                d={dayPathFor(entry, geometry, max)}
                data-testid={`plot-line-${entry.id}`}
                fill="none"
                stroke={`var(--analytics-series-${seriesToken(entry, seriesIndex)})`}
                strokeDasharray={entry.dashed ? '7 5' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {dayDots(entry, days, geometry, max).map((dot) => (
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  data-testid={`plot-dot-${dot.point.id}`}
                  fill={`var(--analytics-series-${seriesToken(entry, seriesIndex)})`}
                  key={dot.point.id}
                  pointerEvents="none"
                  r={DOT_RADIUS}
                />
              ))}
            </g>
          ))}
          {days.map((day, index) => (
            <rect
              data-day-index={index}
              data-testid="plot-day-hit"
              fill="transparent"
              height={PLOT_BOTTOM - TOP}
              key={day.date}
              width={geometry.slot}
              x={xForDay(index, geometry.slot) - geometry.slot / 2}
              y={TOP}
            />
          ))}
          {activeX === null ? null : (
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
      </div>
      {annotation === undefined && unavailable.size === 0 ? null : (
        <p className="text-muted text-xs">{annotation ?? unavailableNote(unavailable.size)}</p>
      )}
    </PlotFrame>
  );
}

export function LinePlot(props: LinePlotProps) {
  const { days, ...rest } = props;
  return days === undefined ? <LegacyLinePlot {...rest} /> : <DayLinePlot {...rest} days={days} />;
}
