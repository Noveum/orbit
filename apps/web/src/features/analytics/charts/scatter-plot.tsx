'use client';

import type { CSSProperties } from 'react';
import { useRef, useState } from 'react';
import { useMeasuredWidth } from '@/lib/use-measured-width.ts';
import { ChartTooltip } from './chart-tooltip.tsx';
import { PlotFrame } from './plot-frame.tsx';
import { PlotGuides } from './plot-guides.tsx';

export interface InsightScatterPoint {
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
  readonly days: number;
}

export interface InsightPercentiles {
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
}

interface ScatterPlotProps {
  readonly label: string;
  readonly points: readonly InsightScatterPoint[];
  readonly percentiles: InsightPercentiles | null;
  readonly unitLabel: string;
}

const HEIGHT = 280;
const LEFT = 56;
const RIGHT = 64;
const TOP = 16;
const BOTTOM = 40;
const PLOT_BOTTOM = HEIGHT - BOTTOM;
const POINT_RADIUS = 3;
const ACTIVE_POINT_RADIUS = 4;
const HIT_RADIUS = 9;
const PERCENTILE_HIT_WIDTH = 12;

const PERCENTILE_KEYS = ['p25', 'p50', 'p75', 'p95'] as const;
type PercentileKey = (typeof PERCENTILE_KEYS)[number];

type ActiveTarget =
  | { readonly kind: 'point'; readonly index: number }
  | { readonly kind: 'percentile'; readonly key: PercentileKey }
  | null;

function isPercentileKey(value: string | undefined): value is PercentileKey {
  return value === 'p25' || value === 'p50' || value === 'p75' || value === 'p95';
}

function percentileDisplayName(key: PercentileKey): string {
  switch (key) {
    case 'p25':
      return '25th percentile';
    case 'p50':
      return 'Median';
    case 'p75':
      return '75th percentile';
    case 'p95':
      return '95th percentile';
  }
}

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatUnitValue(value: number, unitLabel: string): string {
  return `${value.toFixed(1)} ${unitLabel}`;
}

function sortedByDays(points: readonly InsightScatterPoint[]): readonly InsightScatterPoint[] {
  return [...points].sort((left, right) => left.days - right.days);
}

function maxValue(
  points: readonly InsightScatterPoint[],
  percentiles: InsightPercentiles | null,
): number {
  return Math.max(1, percentiles?.p95 ?? 0, ...points.map((point) => point.days));
}

function xForRank(index: number, count: number, plotWidth: number): number {
  return count <= 1 ? LEFT + plotWidth / 2 : LEFT + (index * plotWidth) / (count - 1);
}

function yForValue(value: number, max: number): number {
  return PLOT_BOTTOM - (Math.max(0, value) / max) * (PLOT_BOTTOM - TOP);
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1));
}

function activeFromEventTarget(target: EventTarget): ActiveTarget {
  if (!(target instanceof SVGElement)) return null;
  const pointIndex = target.dataset['pointIndex'];
  if (pointIndex !== undefined) {
    const index = Number(pointIndex);
    return Number.isInteger(index) ? { kind: 'point', index } : null;
  }
  const percentileKey = target.dataset['percentile'];
  return isPercentileKey(percentileKey) ? { kind: 'percentile', key: percentileKey } : null;
}

function isEventInsideAnchor(target: EventTarget): boolean {
  return target instanceof Element && target.closest('a') !== null;
}

interface KeyResult {
  readonly active: ActiveTarget;
  readonly focusAnchor: boolean;
}

function movedPointTarget(current: ActiveTarget, delta: number, count: number): ActiveTarget {
  if (count === 0) return null;
  const currentIndex = current?.kind === 'point' ? current.index : -1;
  return { kind: 'point', index: clampIndex(currentIndex + delta, count) };
}

function keyResult(key: string, active: ActiveTarget, count: number): KeyResult | null {
  switch (key) {
    case 'ArrowRight':
      return { active: movedPointTarget(active, 1, count), focusAnchor: false };
    case 'ArrowLeft':
      return { active: movedPointTarget(active, -1, count), focusAnchor: false };
    case 'Home':
      return { active: count === 0 ? null : { kind: 'point', index: 0 }, focusAnchor: false };
    case 'End':
      return {
        active: count === 0 ? null : { kind: 'point', index: count - 1 },
        focusAnchor: false,
      };
    case 'Escape':
      return { active: null, focusAnchor: false };
    case 'Enter':
      return { active, focusAnchor: active?.kind === 'point' };
    default:
      return null;
  }
}

function tooltipStyle(
  x: number | null,
  y: number | null,
  width: number,
): CSSProperties | undefined {
  if (x === null || y === null) return undefined;
  return {
    left: `${(x / width) * 100}%`,
    top: `${(y / HEIGHT) * 100}%`,
    transform: x > width / 2 ? 'translate(-100%, -110%)' : 'translate(0, -110%)',
  };
}

interface TooltipData {
  readonly label: string;
  readonly series: string;
  readonly value: string;
}

interface ActiveInfo {
  readonly x: number | null;
  readonly y: number | null;
  readonly announcement: string;
  readonly tooltip: TooltipData | null;
}

const EMPTY_ACTIVE_INFO: ActiveInfo = { x: null, y: null, announcement: '', tooltip: null };

function activePointInfo(
  point: InsightScatterPoint,
  index: number,
  sortedPoints: readonly InsightScatterPoint[],
  plotWidth: number,
  max: number,
  unitLabel: string,
): ActiveInfo {
  const value = formatUnitValue(point.days, unitLabel);
  return {
    x: xForRank(index, sortedPoints.length, plotWidth),
    y: yForValue(point.days, max),
    announcement: `${point.identifier}, ${point.title}, ${value}`,
    tooltip: { label: point.identifier, series: point.title, value },
  };
}

function activePercentileInfo(
  key: PercentileKey,
  value: number,
  max: number,
  width: number,
  unitLabel: string,
): ActiveInfo {
  const formatted = formatUnitValue(value, unitLabel);
  const displayName = percentileDisplayName(key);
  return {
    x: width - RIGHT,
    y: yForValue(value, max),
    announcement: `${displayName}, ${formatted}`,
    tooltip: { label: displayName, series: 'Exact value', value: formatted },
  };
}

function activeInfoFor(
  active: ActiveTarget,
  sortedPoints: readonly InsightScatterPoint[],
  percentiles: InsightPercentiles | null,
  max: number,
  plotWidth: number,
  width: number,
  unitLabel: string,
): ActiveInfo {
  if (active?.kind === 'point') {
    const point = sortedPoints[active.index];
    return point === undefined
      ? EMPTY_ACTIVE_INFO
      : activePointInfo(point, active.index, sortedPoints, plotWidth, max, unitLabel);
  }
  if (active?.kind === 'percentile' && percentiles !== null) {
    return activePercentileInfo(active.key, percentiles[active.key], max, width, unitLabel);
  }
  return EMPTY_ACTIVE_INFO;
}

export function ScatterPlot({ label, points, percentiles, unitLabel }: ScatterPlotProps) {
  const { ref, width } = useMeasuredWidth();
  const [active, setActive] = useState<ActiveTarget>(null);
  const anchorRefs = useRef<Array<SVGAElement | null>>([]);
  const sortedPoints = sortedByDays(points);

  if (points.length === 0) {
    return (
      <PlotFrame label={label} legends={[]}>
        <p className="py-12 text-center text-muted text-sm">No completed issues in range yet.</p>
      </PlotFrame>
    );
  }

  const max = maxValue(points, percentiles);
  const plotWidth = width - LEFT - RIGHT;
  const info = activeInfoFor(active, sortedPoints, percentiles, max, plotWidth, width, unitLabel);

  return (
    <PlotFrame
      announcement={info.announcement}
      label={label}
      legends={[]}
      tooltip={
        info.tooltip === null ? null : (
          <ChartTooltip
            label={info.tooltip.label}
            series={info.tooltip.series}
            style={tooltipStyle(info.x, info.y, width)}
            value={info.tooltip.value}
          />
        )
      }
    >
      <div className="w-full" ref={ref}>
        <svg
          aria-label={label}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          height={HEIGHT}
          onFocus={() => {
            if (active === null && sortedPoints.length > 0) setActive({ kind: 'point', index: 0 });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && isEventInsideAnchor(event.target)) return;
            const result = keyResult(event.key, active, sortedPoints.length);
            if (result === null) return;
            setActive(result.active);
            if (result.focusAnchor && result.active?.kind === 'point') {
              anchorRefs.current[result.active.index]?.focus();
            }
            event.preventDefault();
          }}
          onPointerLeave={() => setActive(null)}
          onPointerOver={(event) => {
            const next = activeFromEventTarget(event.target);
            if (next !== null) setActive(next);
          }}
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
            valueFormatter={numberLabel}
            width={width}
            xAxisLabel={`Issues by ${unitLabel}`}
            xTicks={[]}
            yAxisLabel={unitLabel}
          />
          {percentiles === null
            ? null
            : PERCENTILE_KEYS.map((key) => {
                const value = percentiles[key];
                const y = yForValue(value, max);
                return (
                  <g key={key}>
                    <line
                      data-percentile={key}
                      data-testid={`plot-percentile-${key}`}
                      stroke="var(--color-border-strong)"
                      strokeDasharray="4 4"
                      vectorEffect="non-scaling-stroke"
                      x1={LEFT}
                      x2={width - RIGHT}
                      y1={y}
                      y2={y}
                    />
                    <line
                      data-percentile={key}
                      stroke="transparent"
                      strokeWidth={PERCENTILE_HIT_WIDTH}
                      vectorEffect="non-scaling-stroke"
                      x1={LEFT}
                      x2={width - RIGHT}
                      y1={y}
                      y2={y}
                    />
                    <text
                      fill="var(--color-muted)"
                      fontSize="10"
                      textAnchor="start"
                      x={width - RIGHT + 10}
                      y={y + 3}
                    >
                      {formatUnitValue(value, unitLabel)}
                    </text>
                  </g>
                );
              })}
          {sortedPoints.map((point, index) => {
            const x = xForRank(index, sortedPoints.length, plotWidth);
            const y = yForValue(point.days, max);
            const isActive = active?.kind === 'point' && active.index === index;
            return (
              <a
                aria-label={`${point.identifier} ${point.title}`}
                href={`/issue/${point.identifier}`}
                key={point.issueId}
                ref={(node) => {
                  anchorRefs.current[index] = node as unknown as SVGAElement | null;
                }}
              >
                <circle
                  cx={x}
                  cy={y}
                  fill="var(--analytics-series-1)"
                  pointerEvents="none"
                  r={isActive ? ACTIVE_POINT_RADIUS : POINT_RADIUS}
                  stroke="var(--color-surface)"
                  strokeWidth="1"
                />
                <circle
                  cx={x}
                  cy={y}
                  data-point-index={index}
                  data-testid={`plot-scatter-${point.identifier}`}
                  fill="transparent"
                  r={HIT_RADIUS}
                  stroke="transparent"
                />
              </a>
            );
          })}
        </svg>
      </div>
    </PlotFrame>
  );
}
