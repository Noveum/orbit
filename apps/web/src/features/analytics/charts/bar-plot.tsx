'use client';

import type { AnalyticsDrilldownCohort } from '@orbit/shared/validators';
import { useState } from 'react';
import { useMeasuredWidth } from '@/lib/use-measured-width.ts';
import { type AnalyticsDataRow, AnalyticsDataTable } from './analytics-data-table.tsx';
import { ChartTooltip } from './chart-tooltip.tsx';
import type { PlotPoint } from './line-plot.tsx';
import { PlotFrame } from './plot-frame.tsx';

export interface BarPair {
  readonly id: string;
  readonly label: string;
  readonly primary: PlotPoint;
  readonly secondary: PlotPoint;
  readonly current?: boolean;
}

export interface BarPlotAverageLine {
  readonly value: number;
  readonly label: string;
}

export interface BarPlotSegment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

export type BarPlotPoint = Omit<PlotPoint, 'cohort'> & {
  readonly cohort: AnalyticsDrilldownCohort | null;
  readonly segments?: readonly BarPlotSegment[];
};

interface BarPlotProps {
  readonly label: string;
  readonly points: readonly BarPlotPoint[];
  readonly pairs?: readonly BarPair[];
  readonly averageLine?: BarPlotAverageLine;
  readonly onActivate?: (cohort: AnalyticsDrilldownCohort) => void;
  readonly valueFormatter?: (value: number) => string;
  readonly xAxisLabel?: string;
}

const LEFT = 170;
const RIGHT = 64;
const TOP = 12;
const BOTTOM = 42;
const ROW_HEIGHT = 34;
const PAIR_ROW_HEIGHT = 30;
const PAIR_BAR_HEIGHT = 8;
const PAIR_BAR_GAP = 4;
const PAIR_BAR_TOP = 4;

function truncatedLabel(label: string): string {
  return label.length > 24 ? `${label.slice(0, 23)}…` : label;
}

function xTickTestId(ratio: number): string | undefined {
  if (ratio === 0) return 'plot-x-zero';
  if (ratio === 1) return 'plot-x-max';
  return undefined;
}

function indexFromTarget(target: EventTarget): number | null {
  if (!(target instanceof SVGElement)) return null;
  const index = Number(target.dataset['pointIndex']);
  return Number.isInteger(index) ? index : null;
}

function clampRowIndex(index: number, rowCount: number): number | null {
  if (rowCount === 0) return null;
  return Math.max(0, Math.min(index, rowCount - 1));
}

interface BarKeyResult {
  readonly index: number | null;
  readonly activate: boolean;
}

function barKeyResult(
  key: string,
  activeIndex: number | null,
  rowCount: number,
  canActivate: boolean,
): BarKeyResult | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return { index: clampRowIndex((activeIndex ?? -1) + 1, rowCount), activate: false };
    case 'ArrowUp':
    case 'ArrowLeft':
      return { index: clampRowIndex((activeIndex ?? 1) - 1, rowCount), activate: false };
    case 'Home':
      return { index: clampRowIndex(0, rowCount), activate: false };
    case 'End':
      return { index: clampRowIndex(Number.MAX_SAFE_INTEGER, rowCount), activate: false };
    case 'Escape':
      return { index: null, activate: false };
    case 'Enter':
      return canActivate ? { index: activeIndex, activate: true } : null;
    default:
      return null;
  }
}

function barWidthFor(value: number, max: number, plotWidth: number): number {
  return Math.max(2, (value / max) * plotWidth);
}

function valueLabelX(width: number, barEndX: number): number {
  return Math.min(width - RIGHT + 8, barEndX + 8);
}

interface BarGridProps {
  readonly plotWidth: number;
  readonly plotHeight: number;
  readonly max: number;
  readonly valueFormatter: (value: number) => string;
  readonly xAxisLabel: string;
}

function BarGrid({ plotWidth, plotHeight, max, valueFormatter, xAxisLabel }: BarGridProps) {
  return (
    <>
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
      <text
        data-testid="plot-x-axis-label"
        fill="var(--color-muted)"
        fontSize="11"
        fontWeight="500"
        textAnchor="middle"
        x={LEFT + plotWidth / 2}
        y={TOP + plotHeight + BOTTOM - 2}
      >
        {xAxisLabel}
      </text>
    </>
  );
}

interface AverageLineMarkerProps {
  readonly averageLine: BarPlotAverageLine;
  readonly max: number;
  readonly plotWidth: number;
  readonly plotHeight: number;
}

function AverageLineMarker({ averageLine, max, plotWidth, plotHeight }: AverageLineMarkerProps) {
  const ratio = Math.min(1, Math.max(0, averageLine.value / max));
  const x = LEFT + ratio * plotWidth;
  return (
    <g>
      <line
        data-testid="plot-average-line"
        stroke="var(--color-border-strong)"
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
        x1={x}
        x2={x}
        y1={TOP}
        y2={TOP + plotHeight}
      />
      <text fill="var(--color-muted)" fontSize="10" textAnchor="middle" x={x} y={TOP - 2}>
        {averageLine.label}
      </text>
    </g>
  );
}

function pointsMax(points: readonly BarPlotPoint[]): number {
  return Math.max(1, ...points.map((point) => point.value));
}

function pointsRows(
  label: string,
  points: readonly BarPlotPoint[],
  valueFormatter: (value: number) => string,
): AnalyticsDataRow[] {
  return points.map((point) => ({
    id: point.id,
    label: `${label} ${valueFormatter(point.value)}`,
    cells: { label: point.label, value: valueFormatter(point.value) },
    activatable: point.cohort !== null,
  }));
}

function segmentColor(index: number): string {
  return `var(--analytics-series-${(index % 4) + 1})`;
}

interface SegmentedBarProps {
  readonly point: BarPlotPoint;
  readonly segments: readonly BarPlotSegment[];
  readonly index: number;
  readonly isActive: boolean;
  readonly totalWidth: number;
  readonly y: number;
}

function SegmentedBar({ point, segments, index, isActive, totalWidth, y }: SegmentedBarProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  let cursor = 0;
  return (
    <g>
      {segments.map((segment, segmentIndex) => {
        const width = (segment.value / total) * totalWidth;
        const x = LEFT + cursor;
        cursor += width;
        return (
          <rect
            fill={segmentColor(segmentIndex)}
            height="22"
            key={segment.id}
            width={width}
            x={x}
            y={y}
          />
        );
      })}
      <rect
        data-active={isActive ? 'true' : 'false'}
        data-point-index={index}
        data-testid={`plot-hit-${point.id}`}
        fill="transparent"
        height="22"
        width={Math.max(totalWidth, 2)}
        x={LEFT}
        y={y}
      />
    </g>
  );
}

interface PointsTooltipProps {
  readonly point: BarPlotPoint;
  readonly index: number;
  readonly label: string;
  readonly max: number;
  readonly plotWidth: number;
  readonly width: number;
  readonly height: number;
  readonly valueFormatter: (value: number) => string;
}

function PointsTooltip({
  point,
  index,
  label,
  max,
  plotWidth,
  width,
  height,
  valueFormatter,
}: PointsTooltipProps) {
  const style = {
    left: `${((LEFT + (point.value / max) * plotWidth) / width) * 100}%`,
    top: `${((TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2) / height) * 100}%`,
    transform: 'translate(-100%, -110%)',
  };
  if (point.segments !== undefined && point.segments.length > 0) {
    return (
      <ChartTooltip
        label={point.label}
        rows={point.segments.map((segment) => ({
          id: segment.id,
          series: segment.label,
          value: valueFormatter(segment.value),
        }))}
        style={style}
      />
    );
  }
  return (
    <ChartTooltip
      label={point.label}
      series={label}
      style={style}
      value={valueFormatter(point.value)}
    />
  );
}

interface PointsBarPlotProps {
  readonly label: string;
  readonly points: readonly BarPlotPoint[];
  readonly averageLine?: BarPlotAverageLine;
  readonly onActivate?: (cohort: AnalyticsDrilldownCohort) => void;
  readonly valueFormatter?: (value: number) => string;
  readonly xAxisLabel?: string;
}

function PointsBarPlot({
  label,
  points,
  averageLine,
  onActivate,
  valueFormatter = String,
  xAxisLabel = 'Value',
}: PointsBarPlotProps) {
  const { ref, width } = useMeasuredWidth();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activePoint = activeIndex === null ? undefined : points[activeIndex];
  const max = pointsMax(points);
  const plotWidth = width - LEFT - RIGHT;
  const plotHeight = Math.max(ROW_HEIGHT, points.length * ROW_HEIGHT);
  const height = TOP + plotHeight + BOTTOM;
  const rows = pointsRows(label, points, valueFormatter);

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
                  if (selected !== undefined && selected.cohort !== null) {
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
          <PointsTooltip
            height={height}
            index={activeIndex}
            label={label}
            max={max}
            plotWidth={plotWidth}
            point={activePoint}
            valueFormatter={valueFormatter}
            width={width}
          />
        )
      }
    >
      <div className="w-full" ref={ref}>
        <svg
          aria-label={label}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          height={height}
          onClick={(event) => {
            const index = indexFromTarget(event.target);
            const point = index === null ? undefined : points[index];
            if (point !== undefined && point.cohort !== null) onActivate?.(point.cohort);
          }}
          onFocus={() => {
            if (activeIndex === null && points.length > 0) setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            const result = barKeyResult(
              event.key,
              activeIndex,
              points.length,
              activePoint !== undefined && activePoint.cohort !== null && onActivate !== undefined,
            );
            if (result === null) return;
            setActiveIndex(result.index);
            if (result.activate && activePoint !== undefined && activePoint.cohort !== null) {
              onActivate?.(activePoint.cohort);
            }
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
          width={width}
        >
          <title>{label}</title>
          <BarGrid
            max={max}
            plotHeight={plotHeight}
            plotWidth={plotWidth}
            valueFormatter={valueFormatter}
            xAxisLabel={xAxisLabel}
          />
          {points.map((point, index) => {
            const y = TOP + index * ROW_HEIGHT + 6;
            const barWidth = barWidthFor(point.value, max, plotWidth);
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
                {point.segments === undefined || point.segments.length === 0 ? (
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
                ) : (
                  <SegmentedBar
                    index={index}
                    isActive={isActive}
                    point={point}
                    segments={point.segments}
                    totalWidth={barWidth}
                    y={y}
                  />
                )}
                <text
                  data-testid={`plot-value-${point.id}`}
                  fill="var(--color-text)"
                  fontSize="11"
                  fontWeight="600"
                  x={valueLabelX(width, LEFT + barWidth)}
                  y={y + 15}
                >
                  {valueFormatter(point.value)}
                </text>
              </g>
            );
          })}
          {averageLine === undefined ? null : (
            <AverageLineMarker
              averageLine={averageLine}
              max={max}
              plotHeight={plotHeight}
              plotWidth={plotWidth}
            />
          )}
        </svg>
      </div>
    </PlotFrame>
  );
}

function pairsMax(pairs: readonly BarPair[]): number {
  return Math.max(1, ...pairs.flatMap((pair) => [pair.primary.value, pair.secondary.value]));
}

function pairsRows(
  pairs: readonly BarPair[],
  valueFormatter: (value: number) => string,
): AnalyticsDataRow[] {
  return pairs.map((pair) => ({
    id: pair.id,
    label: `${pair.label}, ${pair.primary.label} ${valueFormatter(pair.primary.value)}, ${pair.secondary.label} ${valueFormatter(pair.secondary.value)}`,
    cells: {
      label: pair.label,
      primary: valueFormatter(pair.primary.value),
      secondary: valueFormatter(pair.secondary.value),
    },
  }));
}

function pairRowTop(index: number): number {
  return TOP + index * PAIR_ROW_HEIGHT;
}

function pairPrimaryY(index: number): number {
  return pairRowTop(index) + PAIR_BAR_TOP;
}

function pairSecondaryY(index: number): number {
  return pairPrimaryY(index) + PAIR_BAR_HEIGHT + PAIR_BAR_GAP;
}

interface PairsBarPlotProps {
  readonly label: string;
  readonly pairs: readonly BarPair[];
  readonly averageLine?: BarPlotAverageLine;
  readonly onActivate?: (cohort: AnalyticsDrilldownCohort) => void;
  readonly valueFormatter?: (value: number) => string;
  readonly xAxisLabel?: string;
}

function PairsBarPlot({
  label,
  pairs,
  averageLine,
  onActivate,
  valueFormatter = String,
  xAxisLabel = 'Value',
}: PairsBarPlotProps) {
  const { ref, width } = useMeasuredWidth();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activePair = activeIndex === null ? undefined : pairs[activeIndex];
  const max = pairsMax(pairs);
  const plotWidth = width - LEFT - RIGHT;
  const plotHeight = Math.max(PAIR_ROW_HEIGHT, pairs.length * PAIR_ROW_HEIGHT);
  const height = TOP + plotHeight + BOTTOM;
  const rows = pairsRows(pairs, valueFormatter);
  const primaryLabel = pairs[0]?.primary.label ?? 'Primary';
  const secondaryLabel = pairs[0]?.secondary.label ?? 'Secondary';

  return (
    <PlotFrame
      announcement={
        activePair === undefined
          ? ''
          : `${activePair.label}, ${activePair.primary.label} ${valueFormatter(activePair.primary.value)}, ${activePair.secondary.label} ${valueFormatter(activePair.secondary.value)}`
      }
      dataCount={rows.length}
      label={label}
      legends={[
        { id: 'primary', label: primaryLabel, color: 1 },
        { id: 'secondary', label: secondaryLabel, swatchVar: 'var(--color-border-strong)' },
      ]}
      table={
        <AnalyticsDataTable
          ariaLabel={`${label} data`}
          columns={[
            { id: 'label', label: 'Category' },
            { id: 'primary', label: primaryLabel, align: 'right' },
            { id: 'secondary', label: secondaryLabel, align: 'right' },
          ]}
          rows={rows}
          {...(onActivate === undefined
            ? {}
            : {
                onActivate: (row: AnalyticsDataRow) => {
                  const index = pairs.findIndex((pair) => pair.id === row.id);
                  const selected = pairs[index];
                  if (selected !== undefined) {
                    setActiveIndex(index);
                    onActivate(selected.primary.cohort);
                  }
                },
              })}
          {...(activePair === undefined ? {} : { activeRowId: activePair.id })}
        />
      }
      tooltip={
        activePair === undefined || activeIndex === null ? null : (
          <ChartTooltip
            label={activePair.label}
            rows={[
              {
                id: 'primary',
                series: activePair.primary.label,
                value: valueFormatter(activePair.primary.value),
              },
              {
                id: 'secondary',
                series: activePair.secondary.label,
                value: valueFormatter(activePair.secondary.value),
              },
            ]}
            style={{
              left: `${
                ((LEFT +
                  (Math.max(activePair.primary.value, activePair.secondary.value) / max) *
                    plotWidth) /
                  width) *
                100
              }%`,
              top: `${((pairRowTop(activeIndex) + PAIR_ROW_HEIGHT / 2) / height) * 100}%`,
              transform: 'translate(-100%, -110%)',
            }}
          />
        )
      }
    >
      <div className="w-full" ref={ref}>
        <svg
          aria-label={label}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          height={height}
          onClick={(event) => {
            const index = indexFromTarget(event.target);
            const pair = index === null ? undefined : pairs[index];
            if (pair !== undefined) onActivate?.(pair.primary.cohort);
          }}
          onFocus={() => {
            if (activeIndex === null && pairs.length > 0) setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            const result = barKeyResult(
              event.key,
              activeIndex,
              pairs.length,
              activePair !== undefined && onActivate !== undefined,
            );
            if (result === null) return;
            setActiveIndex(result.index);
            if (result.activate && activePair !== undefined)
              onActivate?.(activePair.primary.cohort);
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
          width={width}
        >
          <title>{label}</title>
          <BarGrid
            max={max}
            plotHeight={plotHeight}
            plotWidth={plotWidth}
            valueFormatter={valueFormatter}
            xAxisLabel={xAxisLabel}
          />
          {pairs.map((pair, index) => {
            const primaryY = pairPrimaryY(index);
            const secondaryY = pairSecondaryY(index);
            const primaryWidth = barWidthFor(pair.primary.value, max, plotWidth);
            const secondaryWidth = barWidthFor(pair.secondary.value, max, plotWidth);
            const isActive = activeIndex === index;
            return (
              <g
                data-testid={pair.current === true ? 'plot-pair-current' : undefined}
                key={pair.id}
              >
                <text
                  data-testid={`plot-category-${pair.id}`}
                  fill="var(--color-muted)"
                  fontSize="11"
                  textAnchor="end"
                  x={LEFT - 10}
                  y={pairRowTop(index) + PAIR_ROW_HEIGHT / 2 + 4}
                >
                  {truncatedLabel(pair.label)}
                </text>
                <rect
                  data-active={isActive ? 'true' : 'false'}
                  data-point-index={index}
                  data-testid={`plot-bar-primary-${pair.id}`}
                  fill="var(--analytics-series-1)"
                  fillOpacity={pair.current === true ? 0.45 : undefined}
                  height={PAIR_BAR_HEIGHT}
                  rx="2"
                  width={primaryWidth}
                  x={LEFT}
                  y={primaryY}
                />
                <rect
                  data-active={isActive ? 'true' : 'false'}
                  data-point-index={index}
                  data-testid={`plot-bar-secondary-${pair.id}`}
                  fill="var(--color-border-strong)"
                  fillOpacity={pair.current === true ? 0.45 : undefined}
                  height={PAIR_BAR_HEIGHT}
                  rx="2"
                  width={secondaryWidth}
                  x={LEFT}
                  y={secondaryY}
                />
              </g>
            );
          })}
          {averageLine === undefined ? null : (
            <AverageLineMarker
              averageLine={averageLine}
              max={max}
              plotHeight={plotHeight}
              plotWidth={plotWidth}
            />
          )}
        </svg>
      </div>
    </PlotFrame>
  );
}

export function BarPlot({ points, pairs, ...rest }: BarPlotProps) {
  return pairs === undefined ? (
    <PointsBarPlot points={points} {...rest} />
  ) : (
    <PairsBarPlot pairs={pairs} {...rest} />
  );
}
