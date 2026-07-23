import type { BurndownPoint, CheckpointView } from '@orbit/core';
import { ChartTable } from '@/features/charts/chart-table.tsx';

const WIDTH = 640;
const HEIGHT = 200;
const PAD = 16;

interface BurndownChartProps {
  readonly points: readonly BurndownPoint[];
  readonly checkpoints: readonly CheckpointView[];
  readonly measureLabel: string;
}

function xFor(index: number, count: number): number {
  if (count <= 1) return PAD;
  return PAD + (index * (WIDTH - PAD * 2)) / (count - 1);
}

function yFor(value: number, max: number): number {
  const span = max <= 0 ? 1 : max;
  return HEIGHT - PAD - (Math.min(value, span) / span) * (HEIGHT - PAD * 2);
}

function pathOf(
  values: ReadonlyArray<{ index: number; value: number }>,
  max: number,
  count: number,
): string {
  return values
    .map((point, order) => {
      const command = order === 0 ? 'M' : 'L';
      return `${command}${xFor(point.index, count).toFixed(1)} ${yFor(point.value, max).toFixed(1)}`;
    })
    .join(' ');
}

function checkpointIndex(points: readonly BurndownPoint[], capturedOn: string): number {
  let match = -1;
  for (let index = 0; index < points.length; index += 1) {
    const day = points[index]?.date ?? '';
    if (day === capturedOn) return index;
    if (day < capturedOn) match = index;
  }
  return match;
}

export function BurndownChart({ points, checkpoints, measureLabel }: BurndownChartProps) {
  const count = points.length;
  if (count === 0) {
    return (
      <p className="py-6 text-center text-faint text-xs">This cycle has no days to plot yet.</p>
    );
  }

  const max = Math.max(
    1,
    ...points.map((point) => Math.max(point.scope, point.ideal, point.remaining ?? 0)),
  );

  const idealSeries = points.map((point, index) => ({ index, value: point.ideal }));
  const scopeSeries = points.map((point, index) => ({ index, value: point.scope }));
  const remainingSeries = points
    .map((point, index) => ({ index, value: point.remaining }))
    .filter((entry): entry is { index: number; value: number } => entry.value !== null);
  const lastPresent = remainingSeries.at(-1)?.index ?? 0;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-dense text-text">Burndown</span>
        <span className="flex flex-wrap items-center gap-3 text-2xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded-full bg-accent" aria-hidden="true" />
            Remaining
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded-full bg-faint" aria-hidden="true" />
            Ideal
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded-full bg-muted" aria-hidden="true" />
            Scope
          </span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-48 w-full"
        role="img"
        aria-label={`Burndown of ${measureLabel.toLowerCase()} with ideal and scope lines`}
      >
        <line
          x1={PAD}
          x2={WIDTH - PAD}
          y1={yFor(0, max)}
          y2={yFor(0, max)}
          stroke="var(--color-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathOf(scopeSeries, max, count)}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={1.25}
          strokeDasharray="1 3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathOf(idealSeries, max, count)}
          fill="none"
          stroke="var(--color-faint)"
          strokeWidth={1.25}
          strokeDasharray="4 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathOf(remainingSeries, max, count)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={xFor(lastPresent, count)}
          x2={xFor(lastPresent, count)}
          y1={PAD}
          y2={HEIGHT - PAD}
          stroke="var(--color-border-strong)"
          strokeWidth={1}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
        {checkpoints.map((checkpoint) => {
          const index = checkpointIndex(points, checkpoint.capturedOn);
          if (index < 0) return null;
          const x = xFor(index, count);
          return (
            <g key={checkpoint.id}>
              <line
                x1={x}
                x2={x}
                y1={PAD}
                y2={HEIGHT - PAD}
                stroke="var(--color-warning)"
                strokeWidth={1}
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={x} cy={yFor(checkpoint.remaining, max)} r={3} fill="var(--color-warning)">
                <title>
                  {checkpoint.label}: {checkpoint.remaining} remaining on {checkpoint.capturedOn}
                </title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-2xs text-faint tabular">
        <span>{points.at(0)?.date}</span>
        <span>{points.at(-1)?.date}</span>
      </div>
      <ChartTable
        caption="Burndown by day"
        columns={['Day', 'Scope', 'Completed', 'Remaining', 'Ideal']}
        rows={points.map((point) => [
          point.date,
          point.scope,
          point.completed ?? '-',
          point.remaining ?? '-',
          point.ideal.toFixed(1),
        ])}
      />
    </figure>
  );
}
